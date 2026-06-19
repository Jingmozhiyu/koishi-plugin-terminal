# koishi-plugin-terminal

[![npm](https://img.shields.io/npm/v/koishi-plugin-terminal?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-terminal)

通过 QQ 发起持久的 Shell 会话。

### 用前须知 ⚠️

- 本插件配置了**白名单列表**和**权限等级**（默认为4）双重保险，确保终端会话不会被恶意发起。
- 目前插件不会拦截任何风险指令，不要将该插件的使用权限授予无法完全信任的用户。

### 使用方法

- 开启终端会话： `shell`
- 结束终端会话： `shell -t`

开启会话后，用户的输入会直接进入终端。发送消息即可和 Shell 交互。

- `echo $PATH > a.txt`
- `ssh bbadger@best-linux.cs.wisc.edu`

通过 QQ 发起的终端会话不支持 vim/nano 等文本编辑器。
