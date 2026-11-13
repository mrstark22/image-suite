"""Derives the background removal model served from public/models/ (#49).

Input: isnet-general-use.onnx from the rembg model release (ISNet "general
use" weights by Xuebin Qin et al., Apache-2.0), SHA-256
60920e99c45464f2ba57bee2ad08c919a52bbf852739e96947fbb4358c0d964a:
https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx

It keeps only the final output (`output_image`; the six side outputs are
for training), converts the weights to float16 with float32 inputs and
outputs, and splits the file into parts under 50 MB. The joined file's
SHA-256 is pinned in src/lib/bg-model.ts.

    pip install onnx==1.* onnxconverter-common
    python3 scripts/derive-bg-model.py isnet-general-use.onnx public/models
"""
import hashlib
import os
import sys

import onnx
from onnxconverter_common import float16

PART_BYTES = 46_000_000
NAME = 'isnet-general-use-fp16.onnx'


def main(src: str, out_dir: str) -> None:
    model = onnx.load(src)
    keep = [o for o in model.graph.output if o.name == 'output_image']
    del model.graph.output[:]
    model.graph.output.extend(keep)
    half = float16.convert_float_to_float16(model, keep_io_types=True)
    data = half.SerializeToString()
    print(NAME, len(data), 'bytes, sha256', hashlib.sha256(data).hexdigest())
    os.makedirs(out_dir, exist_ok=True)
    for i in range(0, len(data), PART_BYTES):
        with open(os.path.join(out_dir, f'{NAME}.part{i // PART_BYTES}'), 'wb') as f:
            f.write(data[i:i + PART_BYTES])


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
