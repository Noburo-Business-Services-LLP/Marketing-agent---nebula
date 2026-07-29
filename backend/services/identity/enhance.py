
import argparse
import os
import shutil
import sys

import cv2

def enhance_image(input_path, output_path, use_gfpgan=False, use_codeformer=False, use_realesrgan=False):
    if not os.path.exists(input_path):
        print(f"Error: Input image not found: {input_path}", file=sys.stderr)
        sys.exit(1)

    current_path = input_path

    if use_gfpgan:
        try:
            from gfpgan import GFPGANer
            restorer = GFPGANer(model_path='https://github.com/TencentARC/GFPGAN/releases/download/v1.3.0/GFPGANv1.3.pth', upscale=1)
            _, _, restored = restorer.enhance(current_path, has_aligned=False, only_center_face=False, paste_back=True)
            temp_path = output_path + '.gfpgan.png'
            cv2.imwrite(temp_path, restored)
            current_path = temp_path
        except Exception as error:
            print(f"GFPGAN unavailable: {error}", file=sys.stderr)

    if use_codeformer:
        try:
            from codeformer import inference_codeformer
            temp_path = output_path + '.codeformer.png'
            inference_codeformer(current_path, temp_path)
            current_path = temp_path
        except Exception as error:
            print(f"CodeFormer unavailable: {error}", file=sys.stderr)

    if use_realesrgan:
        try:
            from realesrgan import RealESRGANer
            from basicsr.archs.rrdbnet_arch import RRDBNet
            model = RRDBNet(num_in_ch=3, num_out_ch=3, num_feat=64, num_block=23, num_grow_ch=32, scale=2)
            upsampler = RealESRGANer(scale=2, model_path='https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x2plus.pth', model=model)
            img = cv2.imread(current_path, cv2.IMREAD_UNCHANGED)
            output, _ = upsampler.enhance(img, outscale=2)
            temp_path = output_path + '.realesrgan.png'
            cv2.imwrite(temp_path, output)
            current_path = temp_path
        except Exception as error:
            print(f"Real-ESRGAN unavailable: {error}", file=sys.stderr)

    os.makedirs(os.path.dirname(output_path) or '.', exist_ok=True)
    shutil.copyfile(current_path, output_path)
    print(f"Enhancement complete: {output_path}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument('input_path')
    parser.add_argument('output_path')
    parser.add_argument('--gfpgan', action='store_true')
    parser.add_argument('--codeformer', action='store_true')
    parser.add_argument('--realesrgan', action='store_true')
    args = parser.parse_args()

    enhance_image(
        args.input_path,
        args.output_path,
        use_gfpgan=args.gfpgan,
        use_codeformer=args.codeformer,
        use_realesrgan=args.realesrgan
    )
