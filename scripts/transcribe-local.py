#!/usr/bin/env python3
"""复用明确配置的本地 FunASR 模型；不上传媒体，不自动下载模型。"""
import argparse
import contextlib
import json
import os
import pathlib
import sys
import tempfile
import wave


def main():
    parser = argparse.ArgumentParser(description="本地 Paraformer 转写")
    parser.add_argument("media", type=pathlib.Path)
    parser.add_argument("--output", required=True, type=pathlib.Path)
    parser.add_argument("--model-root", type=pathlib.Path, default=pathlib.Path.home() / ".cache/modelscope/hub/models/iic")
    args = parser.parse_args()
    root = args.model_root.expanduser()
    models = {
        "model": root / "speech_seaco_paraformer_large_asr_nat-zh-cn-16k-common-vocab8404-pytorch",
        "vad_model": root / "speech_fsmn_vad_zh-cn-16k-common-pytorch",
        "punc_model": root / "punc_ct-transformer_cn-en-common-vocab471067-large",
    }
    for folder in models.values():
        if not folder.is_dir():
            raise FileNotFoundError(f"本地模型不存在：{folder.name}")
    if args.output.exists():
        raise FileExistsError("输出已存在；请指定新文件以保留旧转写")
    os.environ.setdefault("MODELSCOPE_OFFLINE", "1")
    with contextlib.redirect_stdout(sys.stderr):
        import av
        from funasr import AutoModel
        with tempfile.TemporaryDirectory(prefix="source2brain-asr-") as tmp:
            audio = pathlib.Path(tmp) / "audio.wav"
            resampler = av.AudioResampler(format="s16", layout="mono", rate=16000)
            with av.open(str(args.media.expanduser())) as container, wave.open(str(audio), "wb") as output:
                output.setnchannels(1); output.setsampwidth(2); output.setframerate(16000)
                for frame in container.decode(audio=0):
                    for mono in resampler.resample(frame):
                        output.writeframes(mono.to_ndarray().tobytes())
                for mono in resampler.resample(None):
                    output.writeframes(mono.to_ndarray().tobytes())
            model = AutoModel(**{key: str(value) for key, value in models.items()}, device="cpu", ncpu=4, disable_update=True)
            results = model.generate(input=str(audio), batch_size_s=120)
    text = "\n".join(str(item.get("text", "")).strip() for item in results).strip()
    if not text:
        raise RuntimeError("ASR 未返回可读转写")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("x") as file:
        json.dump({"schema_version": 1, "provider": "local-funasr", "model": models["model"].name, "text": text, "segments": results, "limitations": ["机器语音识别结果，未人工逐字校对", "不覆盖视频画面"]}, file, ensure_ascii=False, indent=2)
    args.output.chmod(0o600)
    print(json.dumps({"status": "transcribed", "output": str(args.output.resolve()), "characters": len(text)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
