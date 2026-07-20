import sys
import json

res = {
    "python": sys.version,
    "torch": "not_installed",
    "cuda": False,
    "cuda_version": None,
    "onnx_providers": [],
    "directml_available": False
}

try:
    import torch
    res["torch"] = torch.__version__
    res["cuda"] = torch.cuda.is_available()
    res["cuda_version"] = torch.version.cuda if hasattr(torch, "version") else None
except Exception as e:
    res["torch_err"] = str(e)

try:
    import onnxruntime
    res["onnx_providers"] = onnxruntime.get_available_providers()
except Exception as e:
    res["onnx_err"] = str(e)

try:
    # Check for DirectML (used for AMD/Intel GPU acceleration on Windows)
    import torch_directml
    res["directml_available"] = torch_directml.is_available()
except:
    pass

print(json.dumps(res))
