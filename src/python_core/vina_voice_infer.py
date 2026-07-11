import os
import sys
import argparse
import time
import numpy as np
import onnxruntime
import soundfile as sf
import librosa
import re
import math

def normalize_text(text):
    text = re.sub(r'\s+', ' ', text).strip().lower()
    return text

def list_str_to_idx(text, vocab_char_map):
    idx_list = []
    for c in text:
        if c in vocab_char_map:
            idx_list.append(vocab_char_map[c])
    return np.array([idx_list], dtype=np.int32)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--text', type=str, required=True)
    parser.add_argument('--ref_text', type=str, required=False, default='')
    parser.add_argument('--ref_audio', type=str, required=True)
    parser.add_argument('--output', type=str, required=True)
    parser.add_argument('--speed', type=float, default=1.0)
    parser.add_argument('--models_dir', type=str, default=os.path.join(os.path.dirname(__file__), 'models', 'vina_voice'))
    args = parser.parse_args()

    MODEL_SAMPLE_RATE = 24000
    HOP_LENGTH = 256
    NFE_STEP = 32

    vocab_file = os.path.join(args.models_dir, 'vocab.txt')
    with open(vocab_file, 'r', encoding='utf-8') as f:
        vocab = [line.strip() for line in f.readlines()]
    vocab_char_map = {c: i for i, c in enumerate(vocab)}

    gen_text = normalize_text(args.ref_text + ' ' + args.text)
    text_ids = list_str_to_idx(gen_text, vocab_char_map)
    
    print('Loading and resampling audio...')
    waveform, sr = librosa.load(args.ref_audio, sr=MODEL_SAMPLE_RATE, mono=True)
    
    refaudio = np.array(waveform * 32768.0, dtype=np.int16)
    audio_len = refaudio.shape[-1]
    refaudio = refaudio.reshape(1, 1, -1)

    zh_pause_punc = r"[a-zA-Z0-9]"
    ref_text_len = len(args.ref_text.encode('utf-8')) + 3 * len(re.findall(zh_pause_punc, args.ref_text))
    gen_text_len = len(gen_text.encode('utf-8')) + 3 * len(re.findall(zh_pause_punc, gen_text))
    
    # Avoid div by 0
    ref_text_len = max(ref_text_len, 1)

    ref_audio_len = audio_len // HOP_LENGTH + 1
    max_duration = np.array([ref_audio_len + int(ref_audio_len / ref_text_len * gen_text_len / args.speed)], dtype=np.int64)
    time_step = np.array([0], dtype=np.int32)

    print('Loading models...')
    session_opts = onnxruntime.SessionOptions()
    session_opts.graph_optimization_level = onnxruntime.GraphOptimizationLevel.ORT_ENABLE_ALL

    providers = ['CUDAExecutionProvider', 'DmlExecutionProvider', 'CPUExecutionProvider']
    
    model_A_path = os.path.join(args.models_dir, 'model-tts_0.onnx')
    model_B_path = os.path.join(args.models_dir, 'model-tts_1.onnx')
    model_C_path = os.path.join(args.models_dir, 'model-tts_2.onnx')

    ort_A = onnxruntime.InferenceSession(model_A_path, sess_options=session_opts, providers=providers)
    ort_B = onnxruntime.InferenceSession(model_B_path, sess_options=session_opts, providers=providers)
    ort_C = onnxruntime.InferenceSession(model_C_path, sess_options=session_opts, providers=providers)
    
    print('Running Model A...')
    out_A = ort_A.run(None, {
        ort_A.get_inputs()[0].name: refaudio,
        ort_A.get_inputs()[1].name: text_ids,
        ort_A.get_inputs()[2].name: max_duration
    })
    noise, rope_cos_q, rope_sin_q, rope_cos_k, rope_sin_k, cat_mel_text, cat_mel_text_drop, ref_signal_len = out_A

    print('Running Model B (Transformer)...')
    for i in range(0, NFE_STEP - 1):
        out_B = ort_B.run(None, {
            ort_B.get_inputs()[0].name: noise,
            ort_B.get_inputs()[1].name: rope_cos_q,
            ort_B.get_inputs()[2].name: rope_sin_q,
            ort_B.get_inputs()[3].name: rope_cos_k,
            ort_B.get_inputs()[4].name: rope_sin_k,
            ort_B.get_inputs()[5].name: cat_mel_text,
            ort_B.get_inputs()[6].name: cat_mel_text_drop,
            ort_B.get_inputs()[7].name: time_step
        })
        noise, time_step = out_B
    
    print('Running Model C (Vocoder)...')
    out_C = ort_C.run(None, {
        ort_C.get_inputs()[0].name: noise,
        ort_C.get_inputs()[1].name: ref_signal_len
    })
    generated_signal = out_C[0]

    sf.write(args.output, generated_signal.reshape(-1), MODEL_SAMPLE_RATE, format='WAVEX')
    print('Done: ' + args.output)

if __name__ == '__main__':
    main()
