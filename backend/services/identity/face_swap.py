
import insightface
import cv2
import sys
import os

def swap_face(reference_image_path, target_image_path, output_path):
    if not os.path.exists(reference_image_path):
        print(f"Error: Reference image not found: {reference_image_path}", file=sys.stderr)
        sys.exit(1)
    if not os.path.exists(target_image_path):
        print(f"Error: Target image not found: {target_image_path}", file=sys.stderr)
        sys.exit(1)

    app = insightface.app.FaceAnalysis(name='buffalo_l', providers=['CPUExecutionProvider'])
    app.prepare(ctx_id=0, det_size=(640, 640))

    try:
        swapper = insightface.model_zoo.get_model('inswapper_128.onnx', download=True, download_zip=True)
    except Exception as error:
        print(f"Error: InsightFace inswapper unavailable: {error}", file=sys.stderr)
        sys.exit(1)

    source_img = cv2.imread(reference_image_path)
    target_img = cv2.imread(target_image_path)
    if source_img is None or target_img is None:
        print("Error: Could not read source or target image", file=sys.stderr)
        sys.exit(1)

    source_faces = app.get(source_img)
    target_faces = app.get(target_img)
    if not source_faces or not target_faces:
        print("Error: Face not detected in source or target image", file=sys.stderr)
        sys.exit(1)

    source_face = sorted(source_faces, key=lambda x: (x.bbox[2] - x.bbox[0]) * (x.bbox[3] - x.bbox[1]), reverse=True)[0]
    target_face = sorted(target_faces, key=lambda x: (x.bbox[2] - x.bbox[0]) * (x.bbox[3] - x.bbox[1]), reverse=True)[0]

    result = swapper.get(target_img, target_face, source_face, paste_back=True)
    os.makedirs(os.path.dirname(output_path) or '.', exist_ok=True)
    cv2.imwrite(output_path, result)
    print(f"Face swap complete: {output_path}")

if __name__ == "__main__":
    if len(sys.argv) != 4:
        print("Usage: python face_swap.py <reference_image> <target_image> <output_image>", file=sys.stderr)
        sys.exit(1)

    swap_face(sys.argv[1], sys.argv[2], sys.argv[3])
