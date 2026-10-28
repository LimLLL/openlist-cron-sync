// 中文认证模块文案：登录、改密与会话提示；键与英文完全一致。
import type en from '../en/auth';
import type { Translation } from '../../types';

export default {
  login: {
    title: '登录',
    subtitle: '使用管理员账号登录。',
    formLabel: '管理员登录',
    username: '用户名',
    password: '密码',
    submit: '登录',
    submitting: '正在登录…',
    language: '语言',
    sessionNote: '登录状态会保留到会话过期或主动退出；修改密码会结束所有会话。',
  },
  notice: {
    'password-changed': '密码已更新，请使用新密码登录。',
    expired: '会话已结束，请重新登录。',
    'signed-out': '你已退出登录。',
  },
  password: {
    title: '修改密码',
    forcedDescription: '使用控制台前，请先替换初始密码。',
    description: '修改管理员账号的密码。',
    sessionsEnd: '修改后，所有现有会话都会结束。',
    formLabel: '修改密码',
    currentLabel: '当前密码',
    nextLabel: '新密码',
    nextHint: '12–128 个字符，请为此控制台使用独立的密码。',
    confirmLabel: '确认新密码',
    submit: '更新密码',
    submitting: '正在更新…',
  },
  validation: {
    username: '请输入 1–64 个字符的用户名。',
    passwordLength: '密码需为 12–128 个字符，且不超过 512 个 UTF-8 字节。',
    mismatch: '两次输入的新密码不一致。',
  },
} satisfies Translation<typeof en>;
