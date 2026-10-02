# azrael account UI

Internal account and usage module embedded in the independent `azrael-ex-local.azrael` host. The host supplies its own runtime directly after native chat activation. This directory remains the source/build owner; its `azrael-ex.vsix` is an intermediate package and must not be installed separately.

The profile menu opens **계정 및 사용량** through the single `azrael.usage` entry. The command palette also shows one page entry; `azrael.manageAccounts` and `azrael.devinAccount` remain callable aliases. Existing account capture, login, switching, refresh and Devin helpers reuse the same engine instance and `~/.azrael-ex` state. Original Codex is not an activation dependency.
