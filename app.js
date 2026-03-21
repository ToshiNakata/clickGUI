(() => {
  const LONG_PRESS_MS = 650;
  const TWO_FINGER_TAP_MS = 320;
  const TWO_FINGER_MOVE_PX = 14;
  const MIN_VIEW_SCALE = 0.3;
  const MAX_VIEW_SCALE = 12;
  const HISTORY_LIMIT = 500;
  const AUTOSAVE_STORAGE_KEY = "clickiPad.autosave.v1";

  const state = {
    videos: [],
    currentVideoIndex: 0,
    currentFrame: 0,
    currentId: 0,
    idCount: 10,
    frameStep: 1,
    gamma: 1,
    autoAdvance: "none",
    centerAfterPoint: true,
    trailFrames: 5,
    mode: "annotate",
    annotations: { x: [], y: [] },
    calibration: null,
    dirty: false,
    lastSavedSnapshot: null,
    history: [],
    future: [],
    pendingAutosaveRestore: null,
    interaction: null,
    navGesture: null,
    touchGesture: null,
    touchTwoFingerTap: null,
    activePointers: new Map(),
    twoFingerTap: null,
    renderToken: 0,
    defaultFps: 30,
  };

  const els = {
    videoInput: document.getElementById("videoInput"),
    annotationInput: document.getElementById("annotationInput"),
    calibrationInput: document.getElementById("calibrationInput"),
    saveButton: document.getElementById("saveButton"),
    dirtyChip: document.getElementById("dirtyChip"),
    videoTabs: document.getElementById("videoTabs"),
    annotateModeButton: document.getElementById("annotateModeButton"),
    navigateModeButton: document.getElementById("navigateModeButton"),
    resetViewButton: document.getElementById("resetViewButton"),
    videoInfoLabel: document.getElementById("videoInfoLabel"),
    frameInfoLabel: document.getElementById("frameInfoLabel"),
    canvasWrap: document.getElementById("canvasWrap"),
    mainCanvas: document.getElementById("mainCanvas"),
    canvasEmpty: document.getElementById("canvasEmpty"),
    undoButton: document.getElementById("undoButton"),
    redoButton: document.getElementById("redoButton"),
    currentIdInput: document.getElementById("currentIdInput"),
    decreaseCurrentIdButton: document.getElementById("decreaseCurrentIdButton"),
    increaseCurrentIdButton: document.getElementById("increaseCurrentIdButton"),
    idCountInput: document.getElementById("idCountInput"),
    decreaseIdCountButton: document.getElementById("decreaseIdCountButton"),
    increaseIdCountButton: document.getElementById("increaseIdCountButton"),
    trailFramesInput: document.getElementById("trailFramesInput"),
    fpsInput: document.getElementById("fpsInput"),
    jumpMissingButton: document.getElementById("jumpMissingButton"),
    deletePointButton: document.getElementById("deletePointButton"),
    centerAfterPointInput: document.getElementById("centerAfterPointInput"),
    selectionInfo: document.getElementById("selectionInfo"),
    coordinateInfo: document.getElementById("coordinateInfo"),
    prevFrameButton: document.getElementById("prevFrameButton"),
    nextFrameButton: document.getElementById("nextFrameButton"),
    frameNumberInput: document.getElementById("frameNumberInput"),
    frameSlider: document.getElementById("frameSlider"),
    stepFramesInput: document.getElementById("stepFramesInput"),
    decreaseStepFramesButton: document.getElementById("decreaseStepFramesButton"),
    increaseStepFramesButton: document.getElementById("increaseStepFramesButton"),
    gammaInput: document.getElementById("gammaInput"),
    gammaValue: document.getElementById("gammaValue"),
    videoPool: document.getElementById("videoPool"),
  };

  const displayCtx = els.mainCanvas.getContext("2d");
  const frameCanvas = document.createElement("canvas");
  const frameCtx = frameCanvas.getContext("2d", { willReadFrequently: true });
  const gammaLutCache = new Map();

  init();

  function init() {
    initializeAutosaveRecovery();
    bindEvents();
    resizeCanvas();
    updateAllUi();
    drawEmptyState();
  }

  function bindEvents() {
    els.videoInput.addEventListener("change", handleVideoInput);
    els.annotationInput.addEventListener("change", handleAnnotationInput);
    els.calibrationInput.addEventListener("change", handleCalibrationInput);
    els.saveButton.addEventListener("click", saveAnnotationsToDisk);
    els.undoButton.addEventListener("click", undo);
    els.redoButton.addEventListener("click", redo);
    els.deletePointButton.addEventListener("click", deleteSelectedPoint);
    els.jumpMissingButton.addEventListener("click", jumpToNextMissingFrame);
    els.prevFrameButton.addEventListener("click", () => stepFrame(-1));
    els.nextFrameButton.addEventListener("click", () => stepFrame(1));
    els.resetViewButton.addEventListener("click", resetActiveView);
    els.annotateModeButton.addEventListener("click", () => setMode("annotate"));
    els.navigateModeButton.addEventListener("click", () => setMode("navigate"));
    els.decreaseCurrentIdButton.addEventListener("click", () => setCurrentId(state.currentId - 1));
    els.increaseCurrentIdButton.addEventListener("click", () => setCurrentId(state.currentId + 1));
    els.currentIdInput.addEventListener("change", () => setCurrentId(readPositiveInteger(els.currentIdInput.value, 1) - 1));
    els.decreaseIdCountButton.addEventListener("click", () => setIdCount(state.idCount - 1));
    els.increaseIdCountButton.addEventListener("click", () => setIdCount(state.idCount + 1));
    els.idCountInput.addEventListener("change", () => setIdCount(readPositiveInteger(els.idCountInput.value, state.idCount)));
    els.trailFramesInput.addEventListener("change", () => {
      state.trailFrames = Math.max(0, readPositiveInteger(els.trailFramesInput.value, state.trailFrames));
      renderFrameIfReady();
    });
    els.fpsInput.addEventListener("change", () => applyFpsToCurrentVideo(readPositiveNumber(els.fpsInput.value, state.defaultFps)));
    els.centerAfterPointInput.addEventListener("change", () => {
      state.centerAfterPoint = els.centerAfterPointInput.checked;
    });
    els.decreaseStepFramesButton.addEventListener("click", () => setFrameStep(state.frameStep - 1));
    els.increaseStepFramesButton.addEventListener("click", () => setFrameStep(state.frameStep + 1));
    els.stepFramesInput.addEventListener("change", () => {
      setFrameStep(readPositiveInteger(els.stepFramesInput.value, state.frameStep));
    });
    els.gammaInput.addEventListener("input", () => {
      state.gamma = clamp(readPositiveNumber(els.gammaInput.value, 1), 0.1, 2);
      updateGammaUi();
      renderCurrentFrame({ forceBufferRefresh: true }).catch(handleRenderError);
    });
    els.frameNumberInput.addEventListener("change", () => {
      setCurrentFrame(readPositiveInteger(els.frameNumberInput.value, 1) - 1);
    });
    els.frameSlider.addEventListener("input", () => {
      setCurrentFrame(readPositiveInteger(els.frameSlider.value, 1) - 1);
    });

    document.querySelectorAll('input[name="autoAdvance"]').forEach((radio) => {
      radio.addEventListener("change", (event) => {
        if (event.target.checked) {
          state.autoAdvance = event.target.value;
        }
      });
    });

    els.mainCanvas.addEventListener("pointerdown", handlePointerDown);
    els.mainCanvas.addEventListener("pointermove", handlePointerMove);
    els.mainCanvas.addEventListener("pointerup", handlePointerUp);
    els.mainCanvas.addEventListener("pointercancel", handlePointerCancel);
    els.mainCanvas.addEventListener("wheel", handleWheel, { passive: false });
    els.mainCanvas.addEventListener("touchstart", handleTouchStart, { passive: false });
    els.mainCanvas.addEventListener("touchmove", handleTouchMove, { passive: false });
    els.mainCanvas.addEventListener("touchend", handleTouchEnd, { passive: false });
    els.mainCanvas.addEventListener("touchcancel", handleTouchCancel, { passive: false });
    els.mainCanvas.addEventListener("contextmenu", (event) => event.preventDefault());

    window.addEventListener("resize", () => {
      resizeCanvas();
      renderFrameIfReady();
    });

    if ("ResizeObserver" in window) {
      const observer = new ResizeObserver(() => {
        resizeCanvas();
        renderFrameIfReady();
      });
      observer.observe(els.canvasWrap);
    }

    window.addEventListener("keydown", handleKeyDown);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", persistAutosaveSnapshot);
    window.addEventListener("beforeunload", (event) => {
      persistAutosaveSnapshot();
      if (!state.dirty) {
        return;
      }
      event.preventDefault();
      event.returnValue = "";
    });
  }

  async function handleVideoInput(event) {
    const files = Array.from(event.target.files || []).filter(isLikelyVideoFile);
    event.target.value = "";
    if (!files.length) {
      alert("動画ファイルを選択してください。");
      return;
    }
    let loadedVideos = [];

    try {
      const existingKeys = new Set(state.videos.map((video) => makeVideoKey(video.file)));
      const newFiles = files.filter((file) => !existingKeys.has(makeVideoKey(file)));
      if (!newFiles.length) {
        alert("選択した動画はすでに読み込み済みです。");
        return;
      }

      const fps = readPositiveNumber(els.fpsInput.value, state.defaultFps);
      state.defaultFps = fps;
      const startIndex = state.videos.length;
      for (let index = 0; index < newFiles.length; index += 1) {
        loadedVideos.push(await createVideoEntry(newFiles[index], fps, startIndex + index));
      }

      if (!state.videos.length) {
        state.videos = loadedVideos;
        state.currentVideoIndex = 0;
        state.currentFrame = 0;
        state.currentId = clamp(state.currentId, 0, Math.max(0, state.idCount - 1));
        state.history = [];
        state.future = [];
        createBlankAnnotations(state.idCount);
        markCleanBaseline();
      } else {
        appendVideoEntries(loadedVideos);
        state.currentVideoIndex = startIndex;
        state.currentFrame = 0;
        state.currentId = clamp(state.currentId, 0, Math.max(0, state.idCount - 1));
        refreshDirtyState();
      }

      maybeApplyPendingAutosaveRestore();
      updateAllUi();
      await renderCurrentFrame({ forceSeek: true, forceBufferRefresh: true });
    } catch (error) {
      if (loadedVideos.length) {
        releaseVideoEntries(loadedVideos);
      }
      alert(`動画を読み込めませんでした: ${error.message}`);
      updateAllUi();
      drawEmptyState();
    }
  }

  async function handleAnnotationInput(event) {
    const [file] = Array.from(event.target.files || []);
    event.target.value = "";
    if (!file) {
      return;
    }

    if (!state.videos.length) {
      alert("先に動画を読み込んでください。");
      return;
    }

    if (state.dirty && !window.confirm("未保存の変更があります。打点JSONを読み込むと現在の作業を上書きします。続けますか？")) {
      return;
    }

    try {
      const payload = JSON.parse(await file.text());
      applyImportedAnnotations(payload);
      await renderCurrentFrame({ forceSeek: true, forceBufferRefresh: true });
    } catch (error) {
      alert(`打点JSONを読み込めませんでした: ${error.message}`);
    }
  }

  async function handleCalibrationInput(event) {
    const [file] = Array.from(event.target.files || []);
    event.target.value = "";
    if (!file) {
      return;
    }

    try {
      state.calibration = JSON.parse(await file.text());
      refreshDirtyState();
      alert("キャリブレーション情報を読み込みました。現在は保存対象として保持するのみです。");
    } catch (error) {
      alert(`キャリブレーションJSONを読み込めませんでした: ${error.message}`);
    }
  }

  function applyImportedAnnotations(raw) {
    const normalized = normalizeImportedPayload(raw);
    const nextIdCount = Math.max(1, normalized.idCount);
    state.idCount = nextIdCount;
    createBlankAnnotations(nextIdCount);

    state.videos.forEach((video, videoIndex) => {
      for (let idIndex = 0; idIndex < state.idCount; idIndex += 1) {
        const importedX = normalized.x[videoIndex] && normalized.x[videoIndex][idIndex] ? normalized.x[videoIndex][idIndex] : [];
        const importedY = normalized.y[videoIndex] && normalized.y[videoIndex][idIndex] ? normalized.y[videoIndex][idIndex] : [];
        for (let frameIndex = 0; frameIndex < video.frameCount; frameIndex += 1) {
          const x = sanitizeCoordinate(importedX[frameIndex]);
          const y = sanitizeCoordinate(importedY[frameIndex]);
          setPointValue(videoIndex, idIndex, frameIndex, x !== null && y !== null ? { x, y } : null, { center: false });
        }
      }
    });

    state.calibration = normalized.calibration !== null && normalized.calibration !== undefined ? normalized.calibration : state.calibration;
    state.currentVideoIndex = clamp(normalized.currentVideoIndex, 0, Math.max(0, state.videos.length - 1));
    state.currentFrame = clamp(normalized.currentFrame, 0, Math.max(0, getCurrentFrameCount() - 1));
    state.currentId = clamp(normalized.currentId, 0, Math.max(0, state.idCount - 1));
    state.history = [];
    state.future = [];
    markCleanBaseline();
    updateAllUi();
  }

  function normalizeImportedPayload(raw) {
    if (!raw || !Array.isArray(raw.x) || !Array.isArray(raw.y)) {
      throw new Error("x / y 配列を含む JSON が必要です。");
    }

    const inferredIdCount = Number(raw.n_point !== undefined ? raw.n_point : raw.idCount !== undefined ? raw.idCount : inferIdCountFromPayload(raw.x));
    return {
      idCount: Number.isFinite(inferredIdCount) ? inferredIdCount : 1,
      currentVideoIndex: readMaybeInteger(raw.currentVideoIndex, 0),
      currentFrame: readMaybeInteger(raw.currentFrame, 0),
      currentId: readMaybeInteger(raw.currentId, 0),
      x: raw.x,
      y: raw.y,
      calibration: raw.calibration !== undefined ? raw.calibration : extractCalibrationFields(raw),
    };
  }

  async function createVideoEntry(file, fps, index) {
    const url = URL.createObjectURL(file);
    const element = document.createElement("video");
    element.preload = "auto";
    element.muted = true;
    element.playsInline = true;
    element.src = url;
    element.dataset.index = String(index);
    els.videoPool.appendChild(element);

    await waitForVideoMetadata(element);

    const duration = Number.isFinite(element.duration) && element.duration > 0 ? element.duration : 0;
    const frameCount = computeFrameCount(duration, fps);
    return {
      file,
      name: file.name,
      url,
      element,
      width: Math.max(1, element.videoWidth || 1),
      height: Math.max(1, element.videoHeight || 1),
      duration,
      fps,
      frameCount,
      view: { scale: 1, panX: 0, panY: 0 },
      renderedFrame: null,
      renderedGamma: null,
    };
  }

  function waitForVideoMetadata(video) {
    return new Promise((resolve, reject) => {
      if (video.readyState >= 1 && video.videoWidth > 0 && video.videoHeight > 0) {
        resolve();
        return;
      }
      const cleanup = () => {
        video.removeEventListener("loadedmetadata", onLoaded);
        video.removeEventListener("loadeddata", onLoaded);
        video.removeEventListener("canplay", onLoaded);
        video.removeEventListener("error", onError);
        clearTimeout(timeoutId);
      };
      const onLoaded = () => {
        if (video.videoWidth > 0 && video.videoHeight > 0) {
          cleanup();
          resolve();
        }
      };
      const onError = () => {
        cleanup();
        reject(new Error("metadata error"));
      };
      const timeoutId = window.setTimeout(() => {
        cleanup();
        reject(new Error("metadata timeout"));
      }, 15000);
      video.addEventListener("loadedmetadata", onLoaded, { once: true });
      video.addEventListener("loadeddata", onLoaded, { once: true });
      video.addEventListener("canplay", onLoaded, { once: true });
      video.addEventListener("error", onError, { once: true });
      video.load();
    });
  }

  function waitForVideoFrame(video) {
    return new Promise((resolve, reject) => {
      if (video.readyState >= 2) {
        resolve();
        return;
      }
      const cleanup = () => {
        video.removeEventListener("loadeddata", onReady);
        video.removeEventListener("canplay", onReady);
        video.removeEventListener("seeked", onReady);
        video.removeEventListener("error", onError);
        clearTimeout(timeoutId);
      };
      const onReady = () => {
        if (video.readyState >= 2) {
          cleanup();
          resolve();
        }
      };
      const onError = () => {
        cleanup();
        reject(new Error("frame load error"));
      };
      const timeoutId = window.setTimeout(() => {
        cleanup();
        reject(new Error("frame load timeout"));
      }, 15000);
      video.addEventListener("loadeddata", onReady, { once: true });
      video.addEventListener("canplay", onReady, { once: true });
      video.addEventListener("seeked", onReady, { once: true });
      video.addEventListener("error", onError, { once: true });
      video.load();
    });
  }

  function releaseAllVideos() {
    releaseVideoEntries(state.videos);
    state.videos = [];
    state.annotations = { x: [], y: [] };
    state.currentVideoIndex = 0;
    state.currentFrame = 0;
    state.currentId = 0;
  }

  function releaseVideoEntries(videos) {
    videos.forEach((video) => {
      video.element.pause();
      video.element.removeAttribute("src");
      video.element.load();
      video.element.remove();
      URL.revokeObjectURL(video.url);
    });
  }

  function appendVideoEntries(videos) {
    videos.forEach((video) => {
      state.videos.push(video);
      state.annotations.x.push(Array.from({ length: state.idCount }, () => Array(video.frameCount).fill(null)));
      state.annotations.y.push(Array.from({ length: state.idCount }, () => Array(video.frameCount).fill(null)));
    });
  }

  function createBlankAnnotations(idCount) {
    state.annotations = {
      x: state.videos.map((video) => Array.from({ length: idCount }, () => Array(video.frameCount).fill(null))),
      y: state.videos.map((video) => Array.from({ length: idCount }, () => Array(video.frameCount).fill(null))),
    };
  }

  function setIdCount(nextCount) {
    const sanitized = Math.max(1, nextCount);
    if (sanitized === state.idCount) {
      updateAllUi();
      return;
    }

    if (!state.videos.length) {
      state.idCount = sanitized;
      state.currentId = clamp(state.currentId, 0, sanitized - 1);
      refreshDirtyState();
      updateAllUi();
      return;
    }

    if (sanitized < state.idCount && hasDataInTruncatedIds(sanitized) && !window.confirm("削除対象の ID に打点があります。ID数を減らしますか？")) {
      updateAllUi();
      return;
    }

    state.annotations.x.forEach((videoArray, videoIndex) => {
      resizeIdArray(videoArray, sanitized, state.videos[videoIndex].frameCount);
      resizeIdArray(state.annotations.y[videoIndex], sanitized, state.videos[videoIndex].frameCount);
    });

    state.idCount = sanitized;
    state.currentId = clamp(state.currentId, 0, sanitized - 1);
    refreshDirtyState();
    updateAllUi();
    renderFrameIfReady();
  }

  function setFrameStep(nextStep) {
    state.frameStep = Math.max(1, nextStep);
    updateAllUi();
  }

  function resizeIdArray(targetArray, nextCount, frameCount) {
    while (targetArray.length < nextCount) {
      targetArray.push(Array(frameCount).fill(null));
    }
    targetArray.length = nextCount;
  }

  function hasDataInTruncatedIds(nextCount) {
    for (let videoIndex = 0; videoIndex < state.videos.length; videoIndex += 1) {
      for (let idIndex = nextCount; idIndex < state.idCount; idIndex += 1) {
        if (state.annotations.x[videoIndex] && state.annotations.x[videoIndex][idIndex] && state.annotations.x[videoIndex][idIndex].some((value) => value !== null)) {
          return true;
        }
      }
    }
    return false;
  }

  function applyFpsToCurrentVideo(nextFps) {
    const sanitized = clamp(readPositiveNumber(nextFps, state.defaultFps), 1, 240);
    state.defaultFps = sanitized;
    const video = getActiveVideo();

    if (!video) {
      updateAllUi();
      return;
    }

    const oldFrameCount = video.frameCount;
    const newFrameCount = computeFrameCount(video.duration, sanitized);
    if (newFrameCount < oldFrameCount && hasDataPastFrame(video, newFrameCount) && !window.confirm("FPS変更により末尾フレームの打点が切り捨てられます。続けますか？")) {
      updateAllUi();
      return;
    }

    video.fps = sanitized;
    video.frameCount = newFrameCount;
    resizeFrameArraysForVideo(state.currentVideoIndex, oldFrameCount, newFrameCount);
    state.currentFrame = clamp(state.currentFrame, 0, Math.max(0, newFrameCount - 1));
    refreshDirtyState();
    updateAllUi();
    renderCurrentFrame({ forceSeek: true, forceBufferRefresh: true }).catch(handleRenderError);
  }

  function resizeFrameArraysForVideo(videoIndex, oldFrameCount, newFrameCount) {
    for (let idIndex = 0; idIndex < state.idCount; idIndex += 1) {
      const xFrames = state.annotations.x[videoIndex][idIndex];
      const yFrames = state.annotations.y[videoIndex][idIndex];
      if (newFrameCount > oldFrameCount) {
        while (xFrames.length < newFrameCount) {
          xFrames.push(null);
          yFrames.push(null);
        }
      } else {
        xFrames.length = newFrameCount;
        yFrames.length = newFrameCount;
      }
    }
  }

  function hasDataPastFrame(video, frameIndex) {
    const videoIndex = state.videos.indexOf(video);
    for (let idIndex = 0; idIndex < state.idCount; idIndex += 1) {
      for (let i = frameIndex; i < state.annotations.x[videoIndex][idIndex].length; i += 1) {
        if (state.annotations.x[videoIndex][idIndex][i] !== null) {
          return true;
        }
      }
    }
    return false;
  }

  function setMode(mode) {
    state.mode = mode === "navigate" ? "navigate" : "annotate";
    updateAllUi();
  }

  function stepFrame(direction) {
    setCurrentFrame(state.currentFrame + direction * state.frameStep);
  }

  function setCurrentFrame(frameIndex) {
    const frameCount = getCurrentFrameCount();
    if (!frameCount) {
      state.currentFrame = 0;
      updateAllUi();
      return;
    }

    const nextFrame = clamp(frameIndex, 0, frameCount - 1);
    if (nextFrame === state.currentFrame) {
      updateAllUi();
      renderFrameIfReady();
      return;
    }

    state.currentFrame = nextFrame;
    updateAllUi();
    renderCurrentFrame({ forceSeek: true, forceBufferRefresh: true }).catch(handleRenderError);
  }

  function setCurrentId(idIndex) {
    const nextId = clamp(idIndex, 0, Math.max(0, state.idCount - 1));
    if (nextId === state.currentId) {
      updateAllUi();
      renderFrameIfReady();
      return;
    }

    state.currentId = nextId;
    updateAllUi();
    renderFrameIfReady();
  }

  function setCurrentVideo(index) {
    const nextIndex = clamp(index, 0, Math.max(0, state.videos.length - 1));
    if (nextIndex === state.currentVideoIndex && state.videos.length) {
      updateAllUi();
      return;
    }

    state.currentVideoIndex = nextIndex;
    state.currentFrame = clamp(state.currentFrame, 0, Math.max(0, getCurrentFrameCount() - 1));
    updateAllUi();
    renderCurrentFrame({ forceSeek: true, forceBufferRefresh: true }).catch(handleRenderError);
  }

  function jumpToNextMissingFrame() {
    if (!state.videos.length) {
      return;
    }

    const videoIndex = state.currentVideoIndex;
    const idIndex = state.currentId;
    const frameCount = getCurrentFrameCount();
    for (let offset = 0; offset < frameCount; offset += 1) {
      const frameIndex = (state.currentFrame + offset) % frameCount;
      if (!getPoint(videoIndex, idIndex, frameIndex)) {
        setCurrentFrame(frameIndex);
        return;
      }
    }
    alert(`ID ${idIndex + 1} に未入力フレームはありません。`);
  }

  function deleteSelectedPoint() {
    if (!state.videos.length) {
      return;
    }

    const before = getPoint(state.currentVideoIndex, state.currentId, state.currentFrame);
    if (!before) {
      return;
    }

    setPointValue(state.currentVideoIndex, state.currentId, state.currentFrame, null, { center: false });
    pushHistoryEntry({
      type: "point",
      videoIndex: state.currentVideoIndex,
      idIndex: state.currentId,
      frameIndex: state.currentFrame,
      before,
      after: null,
    });
    refreshDirtyState();
    updateAllUi();
    renderFrameIfReady();
  }

  function saveAnnotationsToDisk() {
    if (!state.videos.length) {
      return;
    }

    const payload = buildPersistencePayload();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const anchor = document.createElement("a");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const firstVideoName = state.videos[0] && state.videos[0].name ? state.videos[0].name.replace(/\.[^.]+$/, "") : "clickiPad";
    const baseName = sanitizeFilename(firstVideoName || "clickiPad");
    anchor.href = URL.createObjectURL(blob);
    anchor.download = `${baseName}_annotations_${stamp}.json`;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    window.setTimeout(() => {
      URL.revokeObjectURL(anchor.href);
      anchor.remove();
    }, 1000);
    markCleanBaseline();
    clearAutosaveSnapshot();
    updateAllUi();
  }

  function initializeAutosaveRecovery() {
    const payload = readAutosaveSnapshot();
    if (!payload) {
      return;
    }

    if (window.confirm("前回の中断データがあります。復元しますか？")) {
      state.pendingAutosaveRestore = payload;
      return;
    }

    clearAutosaveSnapshot();
  }

  function handleVisibilityChange() {
    if (document.visibilityState === "hidden") {
      persistAutosaveSnapshot();
    }
  }

  function persistAutosaveSnapshot() {
    if (!state.videos.length) {
      return;
    }

    try {
      localStorage.setItem(AUTOSAVE_STORAGE_KEY, JSON.stringify(buildPersistencePayload()));
    } catch (error) {
      console.warn("autosave failed", error);
    }
  }

  function readAutosaveSnapshot() {
    try {
      const raw = localStorage.getItem(AUTOSAVE_STORAGE_KEY);
      if (!raw) {
        return null;
      }
      const payload = JSON.parse(raw);
      if (!payload || !Array.isArray(payload.x) || !Array.isArray(payload.y)) {
        clearAutosaveSnapshot();
        return null;
      }
      return payload;
    } catch (error) {
      clearAutosaveSnapshot();
      return null;
    }
  }

  function clearAutosaveSnapshot() {
    try {
      localStorage.removeItem(AUTOSAVE_STORAGE_KEY);
    } catch (error) {
      console.warn("autosave clear failed", error);
    }
  }

  function maybeApplyPendingAutosaveRestore() {
    if (!state.pendingAutosaveRestore) {
      return false;
    }

    const payload = state.pendingAutosaveRestore;
    const expectedMovieCount = readPositiveInteger(payload.n_movie, payload.videos ? payload.videos.length : 0);
    if (!expectedMovieCount || state.videos.length !== expectedMovieCount) {
      return false;
    }

    if (Array.isArray(payload.videos) && payload.videos.length === state.videos.length) {
      const namesMismatch = payload.videos.some((savedVideo, index) => {
        const currentVideo = state.videos[index];
        return savedVideo && savedVideo.name && currentVideo && currentVideo.name && savedVideo.name !== currentVideo.name;
      });
      if (namesMismatch && !window.confirm("バックアップ時の動画名と現在読み込んだ動画名が一致しません。復元を続けますか？")) {
        return false;
      }
    }

    applyAutosaveRestore(payload);
    state.pendingAutosaveRestore = null;
    return true;
  }

  function applyAutosaveRestore(payload) {
    if (Array.isArray(payload.videos) && payload.videos.length === state.videos.length) {
      state.videos.forEach((video, index) => {
        const savedVideo = payload.videos[index] || {};
        const savedFps = readPositiveNumber(savedVideo.fps, video.fps);
        video.fps = savedFps;
        video.frameCount = Math.max(1, readPositiveInteger(savedVideo.frameCount, computeFrameCount(video.duration, savedFps)));
        video.renderedFrame = null;
        video.renderedGamma = null;
      });
    }

    const nextIdCount = Math.max(1, readPositiveInteger(payload.n_point || payload.idCount, state.idCount));
    state.idCount = nextIdCount;
    createBlankAnnotations(nextIdCount);

    state.videos.forEach((video, videoIndex) => {
      for (let idIndex = 0; idIndex < state.idCount; idIndex += 1) {
        const savedX = payload.x[videoIndex] && payload.x[videoIndex][idIndex] ? payload.x[videoIndex][idIndex] : [];
        const savedY = payload.y[videoIndex] && payload.y[videoIndex][idIndex] ? payload.y[videoIndex][idIndex] : [];
        for (let frameIndex = 0; frameIndex < video.frameCount; frameIndex += 1) {
          const x = sanitizeCoordinate(savedX[frameIndex]);
          const y = sanitizeCoordinate(savedY[frameIndex]);
          setPointValue(videoIndex, idIndex, frameIndex, x !== null && y !== null ? { x, y } : null);
        }
      }
    });

    state.calibration = payload.calibration !== undefined ? payload.calibration : state.calibration;
    state.currentVideoIndex = clamp(readMaybeInteger(payload.currentVideoIndex, 0), 0, Math.max(0, state.videos.length - 1));
    state.currentFrame = clamp(readMaybeInteger(payload.currentFrame, 0), 0, Math.max(0, getCurrentFrameCount() - 1));
    state.currentId = clamp(readMaybeInteger(payload.currentId, 0), 0, Math.max(0, state.idCount - 1));
    state.frameStep = Math.max(1, readPositiveInteger(payload.frameStep, state.frameStep));
    state.gamma = clamp(readPositiveNumber(payload.gamma, state.gamma), 0.1, 2);
    state.autoAdvance = ["frame", "id", "none"].includes(payload.autoAdvance) ? payload.autoAdvance : state.autoAdvance;
    state.centerAfterPoint = typeof payload.centerAfterPoint === "boolean" ? payload.centerAfterPoint : state.centerAfterPoint;
    state.trailFrames = Math.max(0, readPositiveInteger(payload.trailFrames, state.trailFrames));
    state.defaultFps = readPositiveNumber(payload.defaultFps, state.defaultFps);
    state.history = [];
    state.future = [];
    state.lastSavedSnapshot = null;
    state.dirty = true;
    updateAllUi();
  }

  function buildPersistencePayload() {
    return {
      schema: "clickiPad.annotation",
      version: 1,
      savedAt: new Date().toISOString(),
      n_movie: state.videos.length,
      n_point: state.idCount,
      currentVideoIndex: state.currentVideoIndex,
      currentFrame: state.currentFrame,
      currentId: state.currentId,
      frameStep: state.frameStep,
      gamma: state.gamma,
      autoAdvance: state.autoAdvance,
      centerAfterPoint: state.centerAfterPoint,
      trailFrames: state.trailFrames,
      defaultFps: state.defaultFps,
      videos: state.videos.map((video) => ({
        name: video.name,
        width: video.width,
        height: video.height,
        duration: video.duration,
        fps: video.fps,
        frameCount: video.frameCount,
      })),
      calibration: state.calibration,
      x: state.annotations.x,
      y: state.annotations.y,
    };
  }

  function markCleanBaseline() {
    state.lastSavedSnapshot = JSON.stringify(buildPersistencePayload());
    state.dirty = false;
  }

  function refreshDirtyState() {
    if (!state.videos.length) {
      state.dirty = false;
      return;
    }
    persistAutosaveSnapshot();
    if (state.lastSavedSnapshot === null) {
      state.dirty = true;
      updateAllUi();
      return;
    }
    const currentSnapshot = JSON.stringify(buildPersistencePayload());
    state.dirty = currentSnapshot !== state.lastSavedSnapshot;
    updateAllUi();
  }

  function pushHistoryEntry(entry) {
    state.history.push(entry);
    if (state.history.length > HISTORY_LIMIT) {
      state.history.shift();
    }
    state.future = [];
  }

  function undo() {
    const entry = state.history.pop();
    if (!entry) {
      return;
    }
    applyHistoryEntry(entry, "undo");
    state.future.push(entry);
    refreshDirtyState();
    updateAllUi();
    renderCurrentFrame({ forceSeek: true, forceBufferRefresh: false }).catch(handleRenderError);
  }

  function redo() {
    const entry = state.future.pop();
    if (!entry) {
      return;
    }
    applyHistoryEntry(entry, "redo");
    state.history.push(entry);
    refreshDirtyState();
    updateAllUi();
    renderCurrentFrame({ forceSeek: true, forceBufferRefresh: false }).catch(handleRenderError);
  }

  function applyHistoryEntry(entry, direction) {
    if (entry.type !== "point") {
      return;
    }
    const point = direction === "undo" ? entry.before : entry.after;
    setPointValue(entry.videoIndex, entry.idIndex, entry.frameIndex, point, { center: false });
    state.currentVideoIndex = entry.videoIndex;
    state.currentFrame = entry.frameIndex;
    state.currentId = entry.idIndex;
  }

  function updateAllUi() {
    updateTabs();
    updateModeButtons();
    updateFrameUi();
    updateIdUi();
    updateGammaUi();
    updateStatusUi();
    updateSelectionUi();
    updateControlAvailability();
  }

  function updateTabs() {
    els.videoTabs.replaceChildren();
    state.videos.forEach((video, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `tab-button${index === state.currentVideoIndex ? " active" : ""}`;
      button.textContent = `Movie ${index + 1}`;
      button.title = video.name;
      button.addEventListener("click", () => setCurrentVideo(index));
      els.videoTabs.appendChild(button);
    });
  }

  function updateModeButtons() {
    els.annotateModeButton.classList.toggle("active", state.mode === "annotate");
    els.navigateModeButton.classList.toggle("active", state.mode === "navigate");
  }

  function updateFrameUi() {
    const frameCount = getCurrentFrameCount();
    const frameNumber = frameCount ? state.currentFrame + 1 : 1;
    els.frameNumberInput.value = String(frameNumber);
    els.frameNumberInput.max = String(Math.max(1, frameCount));
    els.frameSlider.max = String(Math.max(1, frameCount));
    els.frameSlider.value = String(frameNumber);
    els.stepFramesInput.value = String(state.frameStep);
    els.frameInfoLabel.textContent = frameCount ? `Frame ${frameNumber} / ${frameCount}` : "Frame - / -";
  }

  function updateIdUi() {
    els.currentIdInput.value = String(state.currentId + 1);
    els.currentIdInput.max = String(Math.max(1, state.idCount));
    els.idCountInput.value = String(state.idCount);
    els.trailFramesInput.value = String(state.trailFrames);
    const activeVideo = getActiveVideo();
    els.fpsInput.value = String(activeVideo && activeVideo.fps ? activeVideo.fps : state.defaultFps);
    els.centerAfterPointInput.checked = state.centerAfterPoint;
    document.querySelectorAll('input[name="autoAdvance"]').forEach((radio) => {
      radio.checked = radio.value === state.autoAdvance;
    });
  }

  function updateGammaUi() {
    els.gammaInput.value = state.gamma.toFixed(2);
    els.gammaValue.textContent = state.gamma.toFixed(2);
  }

  function updateStatusUi() {
    els.dirtyChip.textContent = state.dirty ? "Unsaved" : "Saved";
    els.dirtyChip.classList.toggle("dirty", state.dirty);
    els.dirtyChip.classList.toggle("clean", !state.dirty);
    const video = getActiveVideo();
    els.videoInfoLabel.textContent = video
      ? `${video.name} | ${video.width}x${video.height} | ${video.fps.toFixed(2)} fps`
      : "動画未読込";
  }

  function updateSelectionUi() {
    els.selectionInfo.textContent = `ID ${state.currentId + 1} の点を選択中`;
    const point = getPoint(state.currentVideoIndex, state.currentId, state.currentFrame);
    els.coordinateInfo.textContent = point
      ? `座標: x=${point.x.toFixed(1)}, y=${point.y.toFixed(1)}`
      : "座標: -";
  }

  function updateControlAvailability() {
    const hasVideo = state.videos.length > 0;
    const controls = [
      els.saveButton,
      els.annotateModeButton,
      els.navigateModeButton,
      els.undoButton,
      els.redoButton,
      els.deletePointButton,
      els.jumpMissingButton,
      els.decreaseCurrentIdButton,
      els.currentIdInput,
      els.increaseCurrentIdButton,
      els.decreaseIdCountButton,
      els.idCountInput,
      els.increaseIdCountButton,
      els.trailFramesInput,
      els.fpsInput,
      els.centerAfterPointInput,
      els.prevFrameButton,
      els.nextFrameButton,
      els.frameNumberInput,
      els.frameSlider,
      els.decreaseStepFramesButton,
      els.stepFramesInput,
      els.increaseStepFramesButton,
      els.gammaInput,
      els.resetViewButton,
    ];
    controls.forEach((control) => {
      control.disabled = !hasVideo;
    });
    els.undoButton.disabled = !hasVideo || !state.history.length;
    els.redoButton.disabled = !hasVideo || !state.future.length;
    els.deletePointButton.disabled = !hasVideo || !getPoint(state.currentVideoIndex, state.currentId, state.currentFrame);
    els.canvasEmpty.hidden = hasVideo;
  }

  function resizeCanvas() {
    const rect = els.canvasWrap.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    els.mainCanvas.width = Math.max(1, Math.round(rect.width * dpr));
    els.mainCanvas.height = Math.max(1, Math.round(rect.height * dpr));
    displayCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  async function renderCurrentFrame(options = {}) {
    const video = getActiveVideo();
    if (!video) {
      drawEmptyState();
      return;
    }

    const needSeek = options.forceSeek || video.renderedFrame !== state.currentFrame;
    const needBufferRefresh = options.forceBufferRefresh || video.renderedGamma !== state.gamma || frameCanvas.width !== video.width || frameCanvas.height !== video.height;
    const token = ++state.renderToken;

    if (needSeek) {
      const targetTime = frameIndexToTime(video, state.currentFrame);
      await seekVideo(video, targetTime);
      if (token !== state.renderToken) {
        return;
      }
      video.renderedFrame = state.currentFrame;
      video.renderedGamma = null;
    }

    if (needSeek || needBufferRefresh || video.renderedGamma !== state.gamma) {
      paintVideoToBuffer(video);
      if (Math.abs(state.gamma - 1) > 0.001) {
        applyGammaToBuffer(state.gamma);
      }
      video.renderedGamma = state.gamma;
    }

    renderStage();
  }

  function renderFrameIfReady() {
    if (!state.videos.length) {
      drawEmptyState();
      return;
    }
    renderStage();
  }

  function handleRenderError(error) {
    console.error(error);
    alert(`フレーム描画でエラーが発生しました: ${error.message}`);
  }

  function paintVideoToBuffer(video) {
    frameCanvas.width = video.width;
    frameCanvas.height = video.height;
    frameCtx.clearRect(0, 0, video.width, video.height);
    frameCtx.drawImage(video.element, 0, 0, video.width, video.height);
  }

  function applyGammaToBuffer(gamma) {
    const key = gamma.toFixed(2);
    if (!gammaLutCache.has(key)) {
      const lut = new Uint8Array(256);
      for (let i = 0; i < 256; i += 1) {
        lut[i] = Math.max(0, Math.min(255, Math.round(((i / 255) ** gamma) * 255)));
      }
      gammaLutCache.set(key, lut);
    }

    const lut = gammaLutCache.get(key);
    const imageData = frameCtx.getImageData(0, 0, frameCanvas.width, frameCanvas.height);
    const { data } = imageData;
    for (let i = 0; i < data.length; i += 4) {
      data[i] = lut[data[i]];
      data[i + 1] = lut[data[i + 1]];
      data[i + 2] = lut[data[i + 2]];
    }
    frameCtx.putImageData(imageData, 0, 0);
  }

  function renderStage() {
    const video = getActiveVideo();
    const rect = els.canvasWrap.getBoundingClientRect();
    displayCtx.clearRect(0, 0, rect.width, rect.height);

    if (!video || !frameCanvas.width || !frameCanvas.height) {
      drawEmptyState();
      return;
    }

    els.canvasEmpty.hidden = true;
    const transform = getVideoTransform(video);
    drawBackdrop(rect.width, rect.height);
    displayCtx.drawImage(frameCanvas, transform.originX, transform.originY, transform.drawWidth, transform.drawHeight);
    drawTrajectory(transform);
    drawCurrentFramePoints(transform);
    drawActivePoint(transform);
    updateSelectionUi();
  }

  function drawBackdrop(width, height) {
    displayCtx.fillStyle = "rgba(6, 10, 12, 0.32)";
    displayCtx.fillRect(0, 0, width, height);
  }

  function drawTrajectory(transform) {
    const trail = Math.max(0, state.trailFrames);
    if (!trail) {
      return;
    }

    const points = [];
    for (let frameIndex = Math.max(0, state.currentFrame - trail); frameIndex <= Math.min(getCurrentFrameCount() - 1, state.currentFrame + trail); frameIndex += 1) {
      const point = getPoint(state.currentVideoIndex, state.currentId, frameIndex);
      if (point) {
        points.push(worldToScreen(point, transform));
      }
    }

    if (!points.length) {
      return;
    }

    displayCtx.save();
    displayCtx.strokeStyle = "rgba(255, 223, 96, 0.46)";
    displayCtx.fillStyle = "rgba(255, 223, 96, 0.92)";
    displayCtx.lineWidth = 2;
    displayCtx.beginPath();
    points.forEach((point, index) => {
      if (index === 0) {
        displayCtx.moveTo(point.x, point.y);
      } else {
        displayCtx.lineTo(point.x, point.y);
      }
    });
    displayCtx.stroke();
    points.forEach((point) => {
      displayCtx.beginPath();
      displayCtx.arc(point.x, point.y, 2, 0, Math.PI * 2);
      displayCtx.fill();
    });
    displayCtx.restore();
  }

  function drawCurrentFramePoints(transform) {
    displayCtx.save();
    for (let idIndex = 0; idIndex < state.idCount; idIndex += 1) {
      if (idIndex === state.currentId) {
        continue;
      }
      const point = getPoint(state.currentVideoIndex, idIndex, state.currentFrame);
      if (!point) {
        continue;
      }
      const screen = worldToScreen(point, transform);
      drawPointMarker(screen.x, screen.y, 2, "rgba(180, 188, 192, 0.92)", "rgba(22, 30, 35, 0.54)", 1);
      drawPointLabel(screen.x, screen.y, idIndex + 1, "rgba(214, 219, 222, 0.92)");
    }
    displayCtx.restore();
  }

  function drawActivePoint(transform) {
    const point = getPoint(state.currentVideoIndex, state.currentId, state.currentFrame);
    if (!point) {
      return;
    }
    const screen = worldToScreen(point, transform);
    drawPointMarker(screen.x, screen.y, 2.5, "rgba(116, 233, 170, 0.98)", "rgba(5, 73, 50, 0.86)", 1);
    drawPointLabel(screen.x, screen.y, state.currentId + 1, "rgba(185, 255, 219, 0.96)");
    displayCtx.save();
    displayCtx.strokeStyle = "rgba(255, 255, 255, 0.8)";
    displayCtx.lineWidth = 1;
    displayCtx.beginPath();
    displayCtx.arc(screen.x, screen.y, 6, 0, Math.PI * 2);
    displayCtx.stroke();
    displayCtx.restore();
  }

  function drawPointMarker(x, y, radius, fill, stroke, lineWidth = 1) {
    displayCtx.save();
    displayCtx.beginPath();
    displayCtx.arc(x, y, radius, 0, Math.PI * 2);
    displayCtx.fillStyle = fill;
    displayCtx.fill();
    displayCtx.lineWidth = lineWidth;
    displayCtx.strokeStyle = stroke;
    displayCtx.stroke();
    displayCtx.restore();
  }

  function drawPointLabel(x, y, label, color) {
    displayCtx.save();
    displayCtx.fillStyle = color;
    displayCtx.font = '700 12px "Avenir Next", "Hiragino Sans", sans-serif';
    displayCtx.textAlign = "center";
    displayCtx.textBaseline = "bottom";
    displayCtx.fillText(String(label), x, y - 14);
    displayCtx.restore();
  }

  function drawEmptyState() {
    const rect = els.canvasWrap.getBoundingClientRect();
    displayCtx.clearRect(0, 0, rect.width, rect.height);
    els.canvasEmpty.hidden = false;
    drawBackdrop(rect.width, rect.height);
  }

  function handlePointerDown(event) {
    if (!state.videos.length) {
      return;
    }
    if (event.pointerType === "touch") {
      return;
    }
    if (typeof event.button === "number" && event.button !== 0) {
      return;
    }
    event.preventDefault();

    const point = canvasPointFromEvent(event);
    state.activePointers.set(event.pointerId, {
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      x: point.x,
      y: point.y,
      startX: point.x,
      startY: point.y,
      downAt: performance.now(),
    });

    registerTwoFingerTapCandidate();

    if (state.mode === "navigate") {
      els.mainCanvas.setPointerCapture(event.pointerId);
      startOrUpdateNavigationGesture();
      return;
    }

    const worldPoint = screenToWorld(point.x, point.y);
    const hit = hitTestCurrentFrame(point.x, point.y);

    if (hit) {
      state.currentId = hit.idIndex;
      const before = clonePoint(getPoint(state.currentVideoIndex, hit.idIndex, state.currentFrame));
      state.interaction = {
        type: "point",
        pointerId: event.pointerId,
        videoIndex: state.currentVideoIndex,
        idIndex: hit.idIndex,
        frameIndex: state.currentFrame,
        before,
        createdNew: false,
        deletedByLongPress: false,
        moved: false,
        longPressTimer: window.setTimeout(() => {
          if (!state.interaction || state.interaction.pointerId !== event.pointerId) {
            return;
          }
          state.interaction.deletedByLongPress = true;
          setPointValue(state.currentVideoIndex, hit.idIndex, state.currentFrame, null);
          renderFrameIfReady();
        }, LONG_PRESS_MS),
      };
      els.mainCanvas.setPointerCapture(event.pointerId);
      updateAllUi();
      renderFrameIfReady();
      return;
    }

    const before = clonePoint(getPoint(state.currentVideoIndex, state.currentId, state.currentFrame));
    setPointValue(state.currentVideoIndex, state.currentId, state.currentFrame, worldPoint);
    state.interaction = {
      type: "point",
      pointerId: event.pointerId,
      videoIndex: state.currentVideoIndex,
      idIndex: state.currentId,
      frameIndex: state.currentFrame,
      before,
      createdNew: before === null,
      deletedByLongPress: false,
      moved: false,
      longPressTimer: null,
    };
    els.mainCanvas.setPointerCapture(event.pointerId);
    updateAllUi();
    renderFrameIfReady();
  }

  function handlePointerMove(event) {
    if (!state.videos.length) {
      return;
    }
    if (event.pointerType === "touch") {
      return;
    }

    const pointer = state.activePointers.get(event.pointerId);
    if (!pointer) {
      return;
    }

    const point = canvasPointFromEvent(event);
    pointer.x = point.x;
    pointer.y = point.y;

    if (state.twoFingerTap) {
      const dx = pointer.x - pointer.startX;
      const dy = pointer.y - pointer.startY;
      state.twoFingerTap.maxMove = Math.max(state.twoFingerTap.maxMove, Math.hypot(dx, dy));
    }

    if (state.mode === "navigate") {
      updateNavigationGesture();
      return;
    }

    if (!state.interaction || state.interaction.pointerId !== event.pointerId) {
      return;
    }

    const movement = Math.hypot(pointer.x - pointer.startX, pointer.y - pointer.startY);
    if (movement > 3) {
      state.interaction.moved = true;
      if (state.interaction.longPressTimer) {
        clearTimeout(state.interaction.longPressTimer);
        state.interaction.longPressTimer = null;
      }
    }

    if (state.interaction.deletedByLongPress) {
      return;
    }

    const worldPoint = screenToWorld(point.x, point.y);
    setPointValue(state.interaction.videoIndex, state.interaction.idIndex, state.interaction.frameIndex, worldPoint, { center: false });
    updateSelectionUi();
    renderFrameIfReady();
  }

  function handlePointerUp(event) {
    if (!state.videos.length) {
      return;
    }
    if (event.pointerType === "touch") {
      return;
    }

    finalizeTwoFingerTapIfNeeded(event.pointerId);

    if (state.mode === "navigate") {
      state.activePointers.delete(event.pointerId);
      startOrUpdateNavigationGesture();
      if (els.mainCanvas.hasPointerCapture(event.pointerId)) {
        els.mainCanvas.releasePointerCapture(event.pointerId);
      }
      return;
    }

    const interaction = state.interaction;
    if (interaction && interaction.pointerId === event.pointerId) {
      if (interaction.longPressTimer) {
        clearTimeout(interaction.longPressTimer);
      }

      const after = clonePoint(getPoint(interaction.videoIndex, interaction.idIndex, interaction.frameIndex));
      if (!pointsEqual(interaction.before, after)) {
        pushHistoryEntry({
          type: "point",
          videoIndex: interaction.videoIndex,
          idIndex: interaction.idIndex,
          frameIndex: interaction.frameIndex,
          before: interaction.before,
          after,
        });
        refreshDirtyState();
      }

      if (!interaction.deletedByLongPress) {
        if (!pointsEqual(interaction.before, after) && after) {
          maybeCenterViewOnPoint(after);
        }
        handleAutoAdvanceAfterPoint();
      } else {
        updateAllUi();
        renderFrameIfReady();
      }

      state.interaction = null;
      if (els.mainCanvas.hasPointerCapture(event.pointerId)) {
        els.mainCanvas.releasePointerCapture(event.pointerId);
      }
    }

    state.activePointers.delete(event.pointerId);
  }

  function handlePointerCancel(event) {
    if (event.pointerType === "touch") {
      return;
    }
    const interaction = state.interaction;
    if (interaction && interaction.pointerId === event.pointerId && interaction.longPressTimer) {
      clearTimeout(interaction.longPressTimer);
    }
    state.interaction = null;
    state.activePointers.delete(event.pointerId);
    startOrUpdateNavigationGesture();
  }

  function handleTouchStart(event) {
    if (!state.videos.length) {
      return;
    }

    const touches = getTouchPoints(event.touches);
    if (touches.length === 2) {
      state.touchTwoFingerTap = {
        startedAt: performance.now(),
        startPoints: touches.map((touch) => ({ id: touch.id, x: touch.x, y: touch.y })),
        maxMove: 0,
      };
    } else if (touches.length > 2) {
      state.touchTwoFingerTap = null;
    }

    if (state.mode !== "navigate") {
      if (touches.length >= 2) {
        event.preventDefault();
      }
      return;
    }

    event.preventDefault();
    startTouchNavigationGesture(touches);
  }

  function handleTouchMove(event) {
    if (!state.videos.length) {
      return;
    }

    const touches = getTouchPoints(event.touches);
    updateTouchTwoFingerTap(touches);

    if (state.mode !== "navigate") {
      return;
    }

    event.preventDefault();
    if (!touches.length) {
      state.touchGesture = null;
      return;
    }

    if (!state.touchGesture) {
      startTouchNavigationGesture(touches);
    }
    updateTouchNavigationGesture(touches);
  }

  function handleTouchEnd(event) {
    if (!state.videos.length) {
      return;
    }

    const remainingTouches = getTouchPoints(event.touches);
    updateTouchTwoFingerTap(remainingTouches);
    finalizeTouchTwoFingerTapIfNeeded(remainingTouches);

    if (state.mode !== "navigate") {
      return;
    }

    event.preventDefault();
    if (!remainingTouches.length) {
      state.touchGesture = null;
      return;
    }
    startTouchNavigationGesture(remainingTouches);
  }

  function handleTouchCancel(event) {
    if (!state.videos.length) {
      return;
    }
    if (state.mode === "navigate") {
      event.preventDefault();
    }
    state.touchGesture = null;
    state.touchTwoFingerTap = null;
  }

  function startTouchNavigationGesture(touches) {
    const view = getActiveView();
    if (!view) {
      return;
    }

    if (touches.length >= 2) {
      const [first, second] = touches;
      const midpoint = {
        x: (first.x + second.x) / 2,
        y: (first.y + second.y) / 2,
      };
      state.touchGesture = {
        type: "pinch",
        anchorWorld: screenToWorld(midpoint.x, midpoint.y),
        startDistance: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y)),
        startScale: view.scale,
      };
      return;
    }

    if (touches.length === 1) {
      const [touch] = touches;
      state.touchGesture = {
        type: "pan",
        touchId: touch.id,
        startTouchX: touch.x,
        startTouchY: touch.y,
        startPanX: view.panX,
        startPanY: view.panY,
      };
      return;
    }

    state.touchGesture = null;
  }

  function updateTouchNavigationGesture(touches) {
    const view = getActiveView();
    if (!view || !state.touchGesture) {
      return;
    }

    if (state.touchGesture.type === "pan" && touches.length === 1) {
      const [touch] = touches;
      view.panX = state.touchGesture.startPanX + (touch.x - state.touchGesture.startTouchX);
      view.panY = state.touchGesture.startPanY + (touch.y - state.touchGesture.startTouchY);
      renderFrameIfReady();
      return;
    }

    if (touches.length >= 2) {
      const [first, second] = touches;
      const midpoint = {
        x: (first.x + second.x) / 2,
        y: (first.y + second.y) / 2,
      };
      const distance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y));
      const targetScale = clamp(
        state.touchGesture.startScale * (distance / Math.max(1, state.touchGesture.startDistance)),
        MIN_VIEW_SCALE,
        MAX_VIEW_SCALE
      );
      applyZoomAroundWorldPoint(view, state.touchGesture.anchorWorld, midpoint, targetScale);
      renderFrameIfReady();
    }
  }

  function updateTouchTwoFingerTap(touches) {
    if (!state.touchTwoFingerTap) {
      return;
    }

    touches.forEach((touch) => {
      const startPoint = state.touchTwoFingerTap.startPoints.find((point) => point.id === touch.id);
      if (!startPoint) {
        return;
      }
      const move = Math.hypot(touch.x - startPoint.x, touch.y - startPoint.y);
      state.touchTwoFingerTap.maxMove = Math.max(state.touchTwoFingerTap.maxMove, move);
    });
  }

  function finalizeTouchTwoFingerTapIfNeeded(remainingTouches) {
    if (!state.touchTwoFingerTap || remainingTouches.length > 0) {
      return;
    }

    const elapsed = performance.now() - state.touchTwoFingerTap.startedAt;
    const shouldUndo = elapsed <= TWO_FINGER_TAP_MS && state.touchTwoFingerTap.maxMove <= TWO_FINGER_MOVE_PX;
    state.touchTwoFingerTap = null;

    if (shouldUndo) {
      undo();
    }
  }

  function registerTwoFingerTapCandidate() {
    const touchPointers = [...state.activePointers.values()].filter((pointer) => pointer.pointerType === "touch");
    if (touchPointers.length === 2) {
      state.twoFingerTap = {
        ids: touchPointers.map((pointer) => pointer.pointerId),
        startedAt: performance.now(),
        maxMove: 0,
      };
    } else if (touchPointers.length > 2) {
      state.twoFingerTap = null;
    }
  }

  function finalizeTwoFingerTapIfNeeded(releasedPointerId) {
    if (!state.twoFingerTap || !state.twoFingerTap.ids.includes(releasedPointerId)) {
      return;
    }
    const remainingTouchPointers = [...state.activePointers.values()].filter((pointer) => pointer.pointerType === "touch" && pointer.pointerId !== releasedPointerId);
    if (remainingTouchPointers.length) {
      return;
    }
    const elapsed = performance.now() - state.twoFingerTap.startedAt;
    const shouldUndo = elapsed <= TWO_FINGER_TAP_MS && state.twoFingerTap.maxMove <= TWO_FINGER_MOVE_PX;
    state.twoFingerTap = null;
    if (shouldUndo) {
      undo();
    }
  }

  function startOrUpdateNavigationGesture() {
    const pointers = [...state.activePointers.values()];
    const view = getActiveView();
    if (!view) {
      return;
    }

    if (pointers.length >= 2) {
      const [first, second] = pointers;
      const midpoint = {
        x: (first.x + second.x) / 2,
        y: (first.y + second.y) / 2,
      };
      state.navGesture = {
        type: "pinch",
        anchorWorld: screenToWorld(midpoint.x, midpoint.y),
        startDistance: Math.hypot(second.x - first.x, second.y - first.y),
        startScale: view.scale,
      };
      return;
    }

    if (pointers.length === 1) {
      const [only] = pointers;
      state.navGesture = {
        type: "pan",
        pointerId: only.pointerId,
        startPointerX: only.x,
        startPointerY: only.y,
        startPanX: view.panX,
        startPanY: view.panY,
      };
      return;
    }

    state.navGesture = null;
  }

  function updateNavigationGesture() {
    const view = getActiveView();
    if (!view || !state.navGesture) {
      return;
    }

    const pointers = [...state.activePointers.values()];
    if (state.navGesture.type === "pan" && pointers.length === 1) {
      const [pointer] = pointers;
      view.panX = state.navGesture.startPanX + (pointer.x - state.navGesture.startPointerX);
      view.panY = state.navGesture.startPanY + (pointer.y - state.navGesture.startPointerY);
      renderFrameIfReady();
      return;
    }

    if (pointers.length >= 2) {
      const [first, second] = pointers;
      const midpoint = {
        x: (first.x + second.x) / 2,
        y: (first.y + second.y) / 2,
      };
      const distance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y));
      const targetScale = clamp(state.navGesture.startScale * (distance / Math.max(1, state.navGesture.startDistance)), MIN_VIEW_SCALE, MAX_VIEW_SCALE);
      applyZoomAroundWorldPoint(view, state.navGesture.anchorWorld, midpoint, targetScale);
      renderFrameIfReady();
    }
  }

  function handleWheel(event) {
    if (!state.videos.length) {
      return;
    }
    event.preventDefault();
    const view = getActiveView();
    if (!view) {
      return;
    }
    const factor = event.deltaY > 0 ? 0.92 : 1.08;
    const targetScale = clamp(view.scale * factor, MIN_VIEW_SCALE, MAX_VIEW_SCALE);
    const point = canvasPointFromEvent(event);
    const anchorWorld = screenToWorld(point.x, point.y);
    applyZoomAroundWorldPoint(view, anchorWorld, point, targetScale);
    renderFrameIfReady();
  }

  function handleKeyDown(event) {
    if (!state.videos.length) {
      return;
    }

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      saveAnnotationsToDisk();
      return;
    }

    if (isEditableTarget(event.target) || isEditableTarget(document.activeElement)) {
      return;
    }

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z" && !event.shiftKey) {
      event.preventDefault();
      undo();
      return;
    }

    if ((event.metaKey || event.ctrlKey) && (event.key.toLowerCase() === "y" || (event.shiftKey && event.key.toLowerCase() === "z"))) {
      event.preventDefault();
      redo();
      return;
    }

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      stepFrame(-1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      stepFrame(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setCurrentId(state.currentId - 1);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setCurrentId(state.currentId + 1);
    } else if (event.key === "Delete" || event.key === "Backspace") {
      deleteSelectedPoint();
    }
  }

  function handleAutoAdvanceAfterPoint() {
    updateAllUi();
    if (state.autoAdvance === "frame") {
      setCurrentFrame(state.currentFrame + state.frameStep);
      return;
    }
    if (state.autoAdvance === "id") {
      setCurrentId(Math.min(state.idCount - 1, state.currentId + 1));
      return;
    }
    renderFrameIfReady();
  }

  function applyZoomAroundWorldPoint(view, worldPoint, screenPoint, targetScale) {
    const video = getActiveVideo();
    const rect = els.canvasWrap.getBoundingClientRect();
    const fitScale = Math.min(rect.width / video.width, rect.height / video.height);
    view.scale = targetScale;
    const scaledVideoWidth = video.width * fitScale * targetScale;
    const scaledVideoHeight = video.height * fitScale * targetScale;
    const centeredOriginX = (rect.width - scaledVideoWidth) / 2;
    const centeredOriginY = (rect.height - scaledVideoHeight) / 2;
    view.panX = screenPoint.x - centeredOriginX - worldPoint.x * fitScale * targetScale;
    view.panY = screenPoint.y - centeredOriginY - worldPoint.y * fitScale * targetScale;
  }

  function resetActiveView() {
    const view = getActiveView();
    if (!view) {
      return;
    }
    view.scale = 1;
    view.panX = 0;
    view.panY = 0;
    renderFrameIfReady();
  }

  function maybeCenterViewOnPoint(point) {
    if (!state.centerAfterPoint) {
      return;
    }
    const view = getActiveView();
    if (!view) {
      return;
    }
    const rect = els.canvasWrap.getBoundingClientRect();
    applyZoomAroundWorldPoint(view, point, { x: rect.width / 2, y: rect.height / 2 }, view.scale);
  }

  function hitTestCurrentFrame(screenX, screenY) {
    const transform = getVideoTransform(getActiveVideo());
    let bestHit = null;
    let bestDistance = Infinity;
    for (let idIndex = 0; idIndex < state.idCount; idIndex += 1) {
      const point = getPoint(state.currentVideoIndex, idIndex, state.currentFrame);
      if (!point) {
        continue;
      }
      const screen = worldToScreen(point, transform);
      const distance = Math.hypot(screen.x - screenX, screen.y - screenY);
      if (distance < 18 && distance < bestDistance) {
        bestDistance = distance;
        bestHit = { idIndex, point };
      }
    }
    return bestHit;
  }

  function getVideoTransform(video) {
    const rect = els.canvasWrap.getBoundingClientRect();
    const fitScale = Math.min(rect.width / video.width, rect.height / video.height);
    const scale = fitScale * video.view.scale;
    const drawWidth = video.width * scale;
    const drawHeight = video.height * scale;
    const originX = (rect.width - drawWidth) / 2 + video.view.panX;
    const originY = (rect.height - drawHeight) / 2 + video.view.panY;
    return { fitScale, scale, drawWidth, drawHeight, originX, originY };
  }

  function worldToScreen(point, transform) {
    return {
      x: transform.originX + point.x * transform.scale,
      y: transform.originY + point.y * transform.scale,
    };
  }

  function screenToWorld(x, y) {
    const video = getActiveVideo();
    const transform = getVideoTransform(video);
    return {
      x: clamp((x - transform.originX) / transform.scale, 0, video.width),
      y: clamp((y - transform.originY) / transform.scale, 0, video.height),
    };
  }

  function canvasPointFromEvent(event) {
    const rect = els.mainCanvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }

  function canvasPointFromClient(clientX, clientY) {
    const rect = els.mainCanvas.getBoundingClientRect();
    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
  }

  function getTouchPoints(touchList) {
    return Array.from(touchList).map((touch) => {
      const point = canvasPointFromClient(touch.clientX, touch.clientY);
      return {
        id: touch.identifier,
        x: point.x,
        y: point.y,
      };
    });
  }

  function getCurrentFrameCount() {
    const video = getActiveVideo();
    return video ? video.frameCount : 0;
  }

  function getActiveVideo() {
    return state.videos[state.currentVideoIndex] || null;
  }

  function getActiveView() {
    const video = getActiveVideo();
    return video ? video.view : null;
  }

  function getPoint(videoIndex, idIndex, frameIndex) {
    const x = state.annotations.x[videoIndex] && state.annotations.x[videoIndex][idIndex] ? state.annotations.x[videoIndex][idIndex][frameIndex] : null;
    const y = state.annotations.y[videoIndex] && state.annotations.y[videoIndex][idIndex] ? state.annotations.y[videoIndex][idIndex][frameIndex] : null;
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  }

  function setPointValue(videoIndex, idIndex, frameIndex, point, options = {}) {
    if (!state.annotations.x[videoIndex] || !state.annotations.x[videoIndex][idIndex]) {
      return;
    }
    state.annotations.x[videoIndex][idIndex][frameIndex] = point ? point.x : null;
    state.annotations.y[videoIndex][idIndex][frameIndex] = point ? point.y : null;
    if (point && options.center) {
      maybeCenterViewOnPoint(point);
    }
  }

  function frameIndexToTime(video, frameIndex) {
    if (!video.duration || !video.fps) {
      return 0;
    }
    const frameDuration = 1 / video.fps;
    const unclamped = (frameIndex + 0.5) * frameDuration;
    return Math.min(Math.max(0, unclamped), Math.max(0, video.duration - Math.min(0.001, frameDuration * 0.25)));
  }

  function seekVideo(video, time) {
    return attemptVideoSeek(video, time, 2);
  }

  function attemptVideoSeek(video, time, retriesLeft) {
    return new Promise((resolve, reject) => {
      const frameTolerance = video.fps ? 0.5 / video.fps : 0.02;
      const targetTime = Math.min(Math.max(0, time), Math.max(0, video.duration - 0.0005));

      if (Math.abs(video.element.currentTime - targetTime) < frameTolerance * 0.25) {
        waitForVideoFrame(video.element).then(() => {
          waitForPresentedVideoFrame(video.element).then(resolve).catch(reject);
        }).catch(reject);
        return;
      }

      const cleanup = () => {
        video.element.removeEventListener("seeked", onSeeked);
        video.element.removeEventListener("error", onError);
      };
      const onSeeked = () => {
        waitForVideoFrame(video.element).then(() => {
          waitForPresentedVideoFrame(video.element).then(() => {
            cleanup();
            if (retriesLeft > 0 && Math.abs(video.element.currentTime - targetTime) > frameTolerance) {
              attemptVideoSeek(video, targetTime, retriesLeft - 1).then(resolve).catch(reject);
              return;
            }
            resolve();
          }).catch((error) => {
            cleanup();
            reject(error);
          });
        }).catch((error) => {
          cleanup();
          reject(error);
        });
      };
      const onError = () => {
        cleanup();
        reject(new Error("seek error"));
      };

      video.element.pause();
      video.element.addEventListener("seeked", onSeeked, { once: true });
      video.element.addEventListener("error", onError, { once: true });
      video.element.currentTime = targetTime;
    });
  }

  function waitForPresentedVideoFrame(video) {
    return new Promise((resolve) => {
      if (typeof video.requestVideoFrameCallback !== "function") {
        resolve();
        return;
      }

      let resolved = false;
      const finish = () => {
        if (resolved) {
          return;
        }
        resolved = true;
        resolve();
      };
      const callbackId = video.requestVideoFrameCallback(() => {
        finish();
      });
      window.setTimeout(() => {
        if (!resolved && typeof video.cancelVideoFrameCallback === "function") {
          video.cancelVideoFrameCallback(callbackId);
        }
        finish();
      }, 120);
    });
  }

  function computeFrameCount(duration, fps) {
    return Math.max(1, Math.round(duration * fps));
  }

  function makeVideoKey(file) {
    return [file.name, file.size, file.lastModified].join("::");
  }

  function isLikelyVideoFile(file) {
    if (file.type && file.type.startsWith("video/")) {
      return true;
    }
    return /\.(mp4|mov|m4v|avi|webm|ogv|mpeg|mpg)$/i.test(file.name || "");
  }

  function inferIdCountFromPayload(x) {
    return x.reduce((max, videoEntry) => Math.max(max, Array.isArray(videoEntry) ? videoEntry.length : 0), 1);
  }

  function sanitizeCoordinate(value) {
    return Number.isFinite(value) ? value : null;
  }

  function extractCalibrationFields(raw) {
    if (raw.camera_matrix || raw.dist_coeffs || raw.rmat || raw.tvec) {
      return {
        camera_matrix: raw.camera_matrix !== undefined ? raw.camera_matrix : null,
        dist_coeffs: raw.dist_coeffs !== undefined ? raw.dist_coeffs : null,
        rmat: raw.rmat !== undefined ? raw.rmat : null,
        tvec: raw.tvec !== undefined ? raw.tvec : null,
      };
    }
    return null;
  }

  function sanitizeFilename(name) {
    return name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_");
  }

  function pointsEqual(a, b) {
    if (!a && !b) {
      return true;
    }
    if (!a || !b) {
      return false;
    }
    return Math.abs(a.x - b.x) < 0.0001 && Math.abs(a.y - b.y) < 0.0001;
  }

  function clonePoint(point) {
    return point ? { x: point.x, y: point.y } : null;
  }

  function readPositiveInteger(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  function readPositiveNumber(value, fallback) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  function readMaybeInteger(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function isEditableTarget(target) {
    if (!target) {
      return false;
    }
    const tagName = target.tagName;
    return target.isContentEditable || tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT";
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }
})();
