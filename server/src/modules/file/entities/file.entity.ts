import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity.js';

/**
 * 文件状态：
 * - `TEMP`   已上传、尚未绑定任何业务对象（超期回收）
 * - `ACTIVE` 至少被一个业务对象引用
 */
export type FileStatus = 'TEMP' | 'ACTIVE';

/**
 * 文件元数据（sys_file）。
 *
 * 存储引擎、校验、下载无关 —— 本表只记录**谁在什么时候传了什么**，
 * 字节去哪由 `StorageDisk` 决定（见 core/storage）。
 *
 * 设计要点：
 *
 * 1. **每用户独立字节，不做跨用户去重**
 *    `objectKey` 由 `(sha256, uploaderId)` 共同派生
 *    （`yyyy/MM/<前两位>/<uploaderId>/<sha256><ext>`），即一个对象键唯一对应一条记录。
 *
 *    为什么放弃跨用户去重：共享同一份字节会让「删除」必须判断「还有没有别人在用」，
 *    而「判断」与「删字节」之间必然有窗口 —— 并发下会删掉别人刚上传的文件。
 *    校内附件重复率低、单文件 10MB 封顶，多存几份的代价远小于这个并发风险的代价。
 *    代价是同一内容被 N 个人上传就占 N 份空间；换来的是删除逻辑可以简单到
 *    「删元数据 + 删字节」，不需要引用计数、不需要对账兜底。
 *
 *    唯一键仍是 `(sha256, uploader_id, delete_time)`：同一用户重复上传同内容复用
 *    同一条记录（秒传），删除权也只作用于自己。把 `delete_time` 纳入唯一键是为了
 *    让软删行不阻塞重新上传（MySQL 唯一索引里 NULL 不冲突）。
 *
 * 2. **多态绑定拆表**（见 FileLink）
 *    文件与业务对象是多对多；如果本表存 biz_type/biz_id，同一附件被两个业务
 *    引用就要存两行（还各算一次物理占用），且删业务对象无法只解绑。
 *
 * 3. **删除**
 *    走软删（deleteTime）；物理对象仅在没有其他有效记录引用同一 objectKey 时才删，
 *    由 FileService 负责判定。
 */
@Entity('sys_file')
@Index('uk_file_sha_uploader', ['sha256', 'uploaderId', 'deleteTime'], {
  unique: true,
})
@Index('idx_file_uploader', ['uploaderId'])
@Index('idx_file_status_expire', ['status', 'expireAt'])
@Index('idx_file_object_key', ['objectKey'])
export class FileEntity extends BaseEntity {
  /** 内容摘要（小写十六进制） */
  @Column({ length: 64, comment: 'SHA-256 内容摘要' })
  sha256: string;

  /** 原始文件名（仅用于展示与下载命名，**不参与**对象存储路径） */
  @Column({ name: 'original_name', length: 255, comment: '原始文件名' })
  originalName: string;

  /** 扩展名（小写，不含点） */
  @Column({ length: 16, default: '', comment: '扩展名' })
  ext: string;

  /** 服务端判定的真实 MIME（经 Magic Number 检测修正，非客户端声明） */
  @Column({ length: 128, comment: '真实 MIME' })
  mime: string;

  /** 字节数；上限见 file.constants.ts，int 足够 */
  @Column({ type: 'int', comment: '字节数' })
  size: number;

  /**
   * 存储盘名（`@nestjs/storage` 的 disk 名，默认 `default`）。
   *
   * 存盘名而不是厂商名：换 MinIO→OSS→本地目录时，只要配置里给出同名盘，
   * 历史记录仍然可读；需要多盘并存（如「图片盘」「归档盘」）也只是配置多一个盘。
   */
  @Column({ length: 32, default: 'default', comment: '存储盘名' })
  disk: string;

  /** 对象键（服务端生成，不含任何用户输入） */
  @Column({ name: 'object_key', length: 255, comment: '对象键' })
  objectKey: string;

  // ---------------- 归属（文件私密性的判定依据） ----------------

  @Column({ name: 'uploader_id', type: 'int', comment: '上传人' })
  uploaderId: number;

  @Column({ name: 'uploader_name', length: 50, default: '', comment: '上传人快照' })
  uploaderName: string;

  @Column({
    name: 'uploader_dept_id',
    type: 'int',
    nullable: true,
    comment: '上传时部门快照',
  })
  uploaderDeptId?: number | null;

  // ---------------- 状态 ----------------

  @Column({ type: 'varchar', length: 16, default: 'TEMP', comment: 'TEMP/ACTIVE' })
  status: FileStatus;

  /** 被业务对象引用的次数（绑定 +1、解绑 -1；0 且 TEMP 超期即回收） */
  @Column({ name: 'ref_count', type: 'int', default: 0, comment: '业务引用数' })
  refCount: number;

  /** 临时文件过期时间（仅 TEMP 状态有意义，清理任务据此回收） */
  @Column({
    name: 'expire_at',
    type: 'datetime',
    nullable: true,
    comment: '临时文件过期时间',
  })
  expireAt?: Date | null;
}
