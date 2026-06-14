import {Schema, Time} from "koishi";
import * as os from "node:os";

export interface Config {
    admin?: Array<string>;
    auth?:number;
    root?: string;
    shell?: string;
    timeout?: number;
    cols?: number;
    rows?: number;
    maxOutputLength: number;
}

export const Config: Schema<Config> = Schema.object({
    admin: Schema.array(String).description("超级管理员用户名单").default([]),
    auth: Schema.number().description("使用本插件所需的最低权限，此外，用户也需要在超级管理员名单中。").min(1).max(4).step(1).default(4),
    root: Schema.string().description("初始工作路径").default(os.homedir()),
    shell: Schema.string().description("Shell路径，留空则自动检测系统默认Shell"),
    timeout: Schema.number().description("超时时长").default(Time.minute),
    cols: Schema.number().description("终端列数").default(80),
    rows: Schema.number().description("终端行数").default(24),
    maxOutputLength: Schema.number().description('单次发送最大输出长度').default(16384),
})
