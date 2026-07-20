# CapCut interoperability adapter notice

This is first-party adapter code vendored from the project-owned repository
`https://github.com/khanhtran0393/capcut-tts-api` at imported commit
`b19cc2afd71c9c92e0906f654d648b7b792d99d4`.

The desktop package contains only the adapter source and the locally compiled
`cronet_helper.dll`. It does not package CapCut, Jianying, `sscronet.dll`,
accounts, cookies, voice files, or other third-party application content.

Customers must install and use CapCut Desktop under the applicable third-party
terms. The release build generates `capcut_runtime_manifest.json` with the byte
size and SHA-256 digest of every packaged adapter file.
