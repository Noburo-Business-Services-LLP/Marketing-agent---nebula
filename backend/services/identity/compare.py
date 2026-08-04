
import insightface
import numpy as np
import cv2
import sys
import os
import json

APP = insightface.app.FaceAnalysis(providers=['CPUExecutionProvider'])
APP.prepare(ctx_id=0, det_size=(640, 640))

def compare_faces(ref_embedding_path, new_image_path):
    if not os.path.exists(ref_embedding_path):
        print(f"Error: Reference embedding not found: {ref_embedding_path}", file=sys.stderr)
        sys.exit(1)

    if not os.path.exists(new_image_path):
        print(f"Error: New image not found: {new_image_path}", file=sys.stderr)
        sys.exit(1)

    try:
        if ref_embedding_path.endswith('.npy'):
            ref_embedding = np.load(ref_embedding_path).astype(np.float32)
        else:
            with open(ref_embedding_path, 'rb') as f:
                ref_embedding = np.frombuffer(f.read(), dtype=np.float32)

        img = cv2.imread(new_image_path)
        if img is None:
            print(f"Error: Could not read image: {new_image_path}", file=sys.stderr)
            sys.exit(1)

        faces = APP.get(img)
        if not faces:
            return 0.0

        faces = sorted(faces, key=lambda x: (x.bbox[2] - x.bbox[0]) * (x.bbox[3] - x.bbox[1]), reverse=True)
        new_embedding = faces[0].normed_embedding
        similarity = float(np.dot(ref_embedding, new_embedding))
        return similarity
    except Exception as e:
        print(f"An error occurred during comparison: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python compare.py <path_to_ref_embedding> <path_to_new_image>", file=sys.stderr)
        sys.exit(1)

    similarity_score = compare_faces(sys.argv[1], sys.argv[2])
    print(json.dumps({"similarity": similarity_score}))
