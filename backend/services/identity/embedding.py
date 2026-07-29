
import insightface
import numpy as np
import cv2
import sys
import os

APP = insightface.app.FaceAnalysis(providers=['CPUExecutionProvider'])
APP.prepare(ctx_id=0, det_size=(640, 640))

def create_embedding(image_path, output_path):
    if not os.path.exists(image_path):
        print(f"Error: Image path does not exist: {image_path}", file=sys.stderr)
        sys.exit(1)

    try:
        img = cv2.imread(image_path)
        if img is None:
            print(f"Error: Could not read image from path: {image_path}", file=sys.stderr)
            sys.exit(1)

        faces = APP.get(img)
        if not faces:
            print(f"Error: No face detected in the image: {image_path}", file=sys.stderr)
            sys.exit(1)

        faces = sorted(faces, key=lambda x: (x.bbox[2] - x.bbox[0]) * (x.bbox[3] - x.bbox[1]), reverse=True)
        embedding = faces[0].normed_embedding.astype(np.float32)

        os.makedirs(os.path.dirname(output_path) or '.', exist_ok=True)
        np.save(output_path if output_path.endswith('.npy') else output_path.replace('.bin', '.npy'), embedding)
        with open(output_path.replace('.npy', '.bin') if output_path.endswith('.npy') else output_path, 'wb') as f:
            f.write(embedding.tobytes())

        print(f"Successfully created embedding and saved to {output_path}")
    except Exception as e:
        print(f"An error occurred: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) == 2 and sys.argv[1] == '--check':
        print('insightface-ready')
        sys.exit(0)

    if len(sys.argv) != 3:
        print("Usage: python embedding.py <path_to_image> <path_to_output_embedding>", file=sys.stderr)
        sys.exit(1)

    create_embedding(sys.argv[1], sys.argv[2])
