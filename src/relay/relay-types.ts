// 描述Sync与Relay之间的具体传输句柄和持久化边界。
import type { Download, DownloadInput } from './download.js';
import type { Block } from './spool.js';
import type { InstanceRecord } from '../database/schema.js';
import type {
  MultipartSnapshot,
  UploadFile,
} from '../openlist/multipart.service.js';

/** 单次文件尝试的固定输入。 */
export interface RelayInput extends DownloadInput {
  /** 当前Operation UUID；仅用于本地块目录。 */
  operationId: string;
  /** Job ID，用于聚合带宽。 */
  jobId: string;
  /** 上传payload的聚合bytes/s，0不限。 */
  bandwidth: number;
  /** 目标固定身份及当前凭据。 */
  target: InstanceRecord;
  /** 目标账号路径与修改时间。 */
  file: UploadFile;
  /** 已派发同步提交（0字节put）的响应收尾期限：停止派发后仍在宽限内等待响应；省略时与signal相同。 */
  control?: AbortSignal;
}
/** 已证明源可读的具体句柄；只属于一个协调器。 */
export interface PreparedTransfer {
  /** 固定请求。 */
  input: RelayInput;
  /** 当前GET及完成偏移。 */
  download: Download;
  /** 首块已成功写盘；重新预留完整chunk前可从此有界缓冲重新发布。 */
  first: Buffer;
  /** 当前尚未释放的全部块，最多两个在途chunk和一个准备chunk。 */
  blocks: Set<Block>;
  /** 释放源连接、目标session和准入位置。 */
  release: () => void;
  /** 只归还预读准入位置；上传开始后调用，幂等。 */
  releaseAdmission: () => void;
  /** 首个有效session；收到后必须先落库。 */
  session?: MultipartSnapshot;
  /** 实际交给上传流的字节，含重传。 */
  transferredBytes: number;
  /** 源EOF已由上层持久化。 */
  sourceComplete: boolean;
  /** complete请求在途时，心跳404不能提前盖过其可能返回的成功证据。 */
  completing: boolean;
}
/** Relay必须等待的持久化检查点。 */
export interface RelayCheckpoints {
  /** 紧邻init/put网络派发之前提交submitting。 */
  submitting: () => void;
  /** 先保存session再允许任何chunk。 */
  session: (snapshot: MultipartSnapshot) => void;
  /** 先保存精确EOF，再开放最后chunk。 */
  eof: () => void;
}
