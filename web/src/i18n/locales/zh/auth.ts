// 中文认证模块文案：登录、改密与会话提示。
import type en from '../en/auth';
import type { Translation } from '../../types';

export default {
  login: {
    eyebrow: '同步观测站',
    headline1: '万物',
    headline2: '皆在轨道。',
    tagline: '为在你的各个世界之间流转的文件，留一处从容的空间。',
    footerRight: '私有控制台',
    sourceDestination: '源 / 目标',
    access: '管理员登录',
    title: '欢迎回来。',
    subtitle: '登录你的同步工作区。',
    formLabel: '管理员登录',
    username: '用户名',
    password: '密码',
    submit: '进入工作区',
    submitting: '登录中…',
    sessionNote: '登录状态会一直保留，直到过期或主动退出。修改密码会结束所有会话。',
  },
  notice: {
    'password-changed': '密码已更新，请使用新密码登录。',
    expired: '会话已结束，请重新登录。',
    'signed-out': '你已退出登录。',
  },
  password: {
    eyebrow: '账户安全',
    forcedTitle: '先换上',
    forcedAccent: '你自己的钥匙。',
    title: '换一把',
    accent: '新的钥匙。',
    forcedDescription: '进入工作区之前，请先替换初始密码。',
    description: '修改管理员账户的密码。',
    sessionsEnd: '修改后，所有现有会话都会结束。',
    formLabel: '修改密码',
    currentLabel: '当前密码',
    nextLabel: '新密码',
    nextHint: '12–128 个字符。请为此控制台使用独立的密码。',
    confirmLabel: '确认新密码',
    submit: '更新密码',
    submitting: '更新中…',
  },
  validation: {
    username: '请输入 1–64 个字符的用户名。',
    passwordLength: '密码需为 12–128 个字符，且不超过 512 个 UTF-8 字节。',
    mismatch: '两次输入的新密码不一致。',
  },
} satisfies Translation<typeof en>;
