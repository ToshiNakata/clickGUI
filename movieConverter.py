import cv2
import imageio

input_file = 'input.avi'   # 実際のファイル名に変更
output_file = 'output.mp4' 

# 動画の読み込み
cap = cv2.VideoCapture(input_file)
total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

print(f"変換を開始します。全フレーム数: {total_frames}")

# imageioのライターを作成
# fps=30: 30fpsの動画として書き出す（コマ落ちは一切しません）
# quality=10: 最高画質（見た目の劣化が一切ない非圧縮に近いレベル。0〜10で指定）
writer = imageio.get_writer(output_file, fps=30.0, quality=10)

count = 0
while True:
    ret, frame = cap.read()
    if not ret:
        break
    
    # OpenCVは色をBGR(青緑赤)の順で読み込むため、標準的なRGB(赤緑青)に直す
    frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    
    # 1フレームずつ最高画質で書き込む
    writer.append_data(frame_rgb)
    
    count += 1
    if count % 100 == 0:
        print(f"処理中... {count} / {total_frames}")

cap.release()
writer.close()
print("最高画質での変換が完了しました！")
