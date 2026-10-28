// 中文概览文案：指标卡、需要处理、正在运行、即将运行、最近运行与首次使用引导；键与英文完全一致。
import type en from '../en/dashboard';
import type { Translation } from '../../types';

export default {
  title: '概览',
  actions: { newInstance: '新建实例', newJob: '新建任务' },
  kpi: {
    label: '关键指标',
    running: '运行中',
    runningSub: '{{real}} 个正式 · {{dry}} 个试运行',
    attentionJobs: '需要处理的任务',
    attentionJobsSub_one: '共 {{count}} 个任务',
    attentionJobsSub_other: '共 {{count}} 个任务',
    attentionInstances: '需要关注的实例',
    attentionInstancesSub_one: '共 {{count}} 个实例',
    attentionInstancesSub_other: '共 {{count}} 个实例',
    nextFire: '下次定时',
    nextFireNone: '没有即将执行的定时',
    loadFailed: '加载失败',
  },
  attention: {
    title: '需要处理',
    loading: '正在加载需要处理的事项…',
    empty: '一切正常',
    emptyDescription: '没有失败的正式运行、无法执行的定时或异常实例。',
    busy: '这个任务已有正在进行的运行。',
    lastTested: '{{time}}测试',
    neverTested: '从未测试',
  },
  running: {
    title: '正在运行',
    empty: '当前没有运行',
    queued: '已排队 {{time}}',
    elapsed: '已运行 {{time}}',
    created: '已新建 {{done}} / {{planned}}',
    transferred: '已传输 {{bytes}}',
    planned: '计划：新建 {{creates}} · 删除 {{deletes}}',
  },
  upcoming: {
    title: '即将运行',
    empty: '没有启用的定时',
  },
  recent: {
    title: '最近运行',
    loading: '正在加载最近运行…',
    empty: '还没有运行记录',
    emptyDescription: '手动或定时运行任务后，记录会显示在这里。',
    notStarted: '未开始',
    columns: {
      job: '任务',
      status: '状态',
      type: '类型',
      trigger: '触发',
      started: '开始',
      duration: '耗时',
      result: '结果',
    },
  },
  onboarding: {
    title: '开始使用',
    description: '三步完成第一次同步。',
    done: '已完成',
    instance: {
      title: '添加 OpenList 实例',
      description: '连接需要互相复制文件的服务器。',
    },
    job: {
      title: '新建任务',
      description: '选择源目录、一个或多个目标以及定时。',
    },
    run: {
      title: '运行任务',
      description: '建议先试运行，预览将要发生的改动。',
    },
  },
} satisfies Translation<typeof en>;
