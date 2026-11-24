import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { IsNull, Repository } from 'typeorm';
import { matchPermission } from '../../common/authz/permission.util.js';
import { ApiException } from '../../common/exceptions/api.exception.js';
import type { JwtUser } from '../auth/auth.interface.js';
import type {
  CreateMenuInput,
  QueryMenuInput,
  UpdateMenuInput,
} from './dto/menu.dto.js';
import { Menu } from './entities/menu.entity.js';

const MSG_MENU_NOT_FOUND = '菜单不存在';
const ROOT_ANCESTORS = '0';

/** 树节点 */
export type MenuTreeNode = Menu & { children: MenuTreeNode[] };

/** 平铺列表 → 树（按 parentId 挂接，找不到父节点即视为根） */
export function buildMenuTree(list: Menu[]): MenuTreeNode[] {
  const map = new Map<number, MenuTreeNode>();
  for (const menu of list) {
    map.set(menu.id, Object.assign(menu as MenuTreeNode, { children: [] }));
  }
  const roots: MenuTreeNode[] = [];
  for (const node of map.values()) {
    const parent = node.parentId ? map.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

/**
 * 菜单服务：管理页全量树 + 前端动态路由树。
 * 写操作走事务（txHost.tx），ancestors 沿父子链维护。
 */
@Injectable()
export class MenuService {
  constructor(
    @InjectRepository(Menu) private readonly menuRepo: Repository<Menu>,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
  ) {}

  /** 管理页：全量菜单树（含按钮 F 与隐藏项） */
  async tree(query: QueryMenuInput): Promise<MenuTreeNode[]> {
    const qb = this.menuRepo.createQueryBuilder('m');
    if (query.keyword) {
      qb.andWhere('m.name LIKE :kw', { kw: `%${query.keyword}%` });
    }
    if (query.status !== undefined) {
      qb.andWhere('m.status = :status', { status: query.status });
    }
    qb.orderBy('m.sort', 'ASC').addOrderBy('m.id', 'ASC');
    return buildMenuTree(await qb.getMany());
  }

  /**
   * 当前用户可见菜单树（前端动态路由）：
   * 条件 status=1 && visible=1 && type!=='F' && 权限码命中。
   * 为免前端丢菜单，把命中节点的祖先链一并带上（祖先按存在性加入，不再校验权限）。
   */
  async routes(user: JwtUser): Promise<MenuTreeNode[]> {
    const list = await this.menuRepo
      .createQueryBuilder('m')
      .where('m.status = :status', { status: 1 })
      .andWhere('m.visible = :visible', { visible: 1 })
      .andWhere('m.type != :btn', { btn: 'F' })
      .orderBy('m.sort', 'ASC')
      .addOrderBy('m.id', 'ASC')
      .getMany();

    const allMap = new Map<number, Menu>();
    for (const menu of list) allMap.set(menu.id, menu);

    // 1. 按权限码筛出可见节点
    const keep = new Set<number>();
    for (const menu of list) {
      // 目录（M）不单独判定：它没有自己的页面，perms 通常为空串。
      // 若把「空 perms 视为命中」用在目录上，就会造出**空壳目录** ——
      // 目录留下、子页面全被权限过滤掉 → 侧边栏显示一个点进去 404 的节点。
      // 目录只允许通过「后代命中 → 补齐祖先链」进入（见第 2 步）。
      if (menu.type === 'M') continue;
      if (!menu.perms || matchPermission(user.permissions ?? [], menu.perms)) {
        keep.add(menu.id);
      }
    }

    // 2. 补齐祖先链（父节点若不可见，仍作为结构节点保留）。
    // 只从**命中权限的节点**出发，所以没有命中后代的目录不会被带进来 →
    // 不会出现「空壳目录」（看得见目录名，点进去没页面）。
    const seedIds = Array.from(keep);
    for (const id of seedIds) {
      let node = allMap.get(id);
      while (node?.parentId) {
        if (keep.has(node.parentId)) break;
        const parent = allMap.get(node.parentId);
        if (!parent) break;
        keep.add(parent.id);
        node = parent;
      }
    }

    const visible = list.filter((menu) => keep.has(menu.id));
    return buildMenuTree(visible);
  }

  /**
   * 前端注册路由用的**全部可导航页面**（不按权限过滤）。
   *
   * 为什么需要它：
   * `routes()` 只返回当前用户有权限的菜单 —— 前端的动态路由也只注册这些。
   * 于是用户手输（或点旧书签）一个**没权限**的地址时，路由表里根本不存在这条，
   * 直接命中 catch-all → 渲染「404 页面不存在」。用户看到的是「这页没了」，
   * 而真相是「你没这个权限」，两件完全不同的事：前者是 bug，后者是预期。
   *
   * 现在把全部 C 型页面都注册成路由，无权限由路由 `meta.perm` 在前置守卫里拦
   * → 渲染 403「没有访问权限」；真的不存在的路径仍然是 404。
   *
   * 安全性：返回的只是菜单结构（路径 / 组件名 / 权限码），不含业务数据；
   * 能拿到它的前提是已登录且通过后台准入。真正的边界始终在后端接口的
   * `@RequiresPermissions` 上，前端注册路由不等于授权。
   */
  async pages(): Promise<Menu[]> {
    return this.menuRepo
      .createQueryBuilder('m')
      .where('m.status = :status', { status: 1 })
      .andWhere('m.type = :type', { type: 'C' })
      .andWhere('m.path != :empty', { empty: '' })
      .orderBy('m.sort', 'ASC')
      .addOrderBy('m.id', 'ASC')
      .getMany();
  }

  async create(dto: CreateMenuInput): Promise<Menu> {
    return this.txHost.withTransaction(async () => {
      const repo = this.txHost.tx.getRepository(Menu);
      const parentId = dto.parentId ?? null;

      // 上级存在性 + ancestors 计算
      let ancestors = ROOT_ANCESTORS;
      if (parentId) {
        const parent = await repo.findOneBy({ id: parentId });
        if (!parent) throw new ApiException('上级菜单不存在');
        ancestors = `${parent.ancestors},${parent.id}`;
      }

      // 同级重名校验
      const dup = await repo.findOneBy({
        parentId: parentId ?? IsNull(),
        name: dto.name,
      });
      if (dup) throw new ApiException('同级菜单名称已存在');

      return repo.save(repo.create({ ...dto, parentId, ancestors }));
    });
  }

  /** 更新菜单；变更上级时校验环并级联重写子孙 ancestors */
  async update(id: number, dto: UpdateMenuInput): Promise<Menu> {
    return this.txHost.withTransaction(async () => {
      const repo = this.txHost.tx.getRepository(Menu);
      const menu = await repo.findOneBy({ id });
      if (!menu) throw new NotFoundException(MSG_MENU_NOT_FOUND);

      const nextParentId =
        dto.parentId !== undefined ? dto.parentId : menu.parentId;
      const parentChanged = (nextParentId ?? null) !== (menu.parentId ?? null);

      let ancestors = menu.ancestors;
      if (parentChanged) {
        if (nextParentId) {
          if (nextParentId === id) {
            throw new ApiException('不能选择自己或下级作为上级菜单');
          }
          const parent = await repo.findOneBy({ id: nextParentId });
          if (!parent) throw new ApiException('上级菜单不存在');
          // parent 的祖先链里含自己 → 说明选的是自己的子孙
          if (parent.ancestors.split(',').includes(String(id))) {
            throw new ApiException('不能选择自己或下级作为上级菜单');
          }
          ancestors = `${parent.ancestors},${parent.id}`;
        } else {
          ancestors = ROOT_ANCESTORS;
        }
      }

      // 同 parentId 下重名校验（改名或换父级时）
      if (dto.name !== undefined || parentChanged) {
        const dup = await repo.findOneBy({
          parentId: nextParentId ?? IsNull(),
          name: dto.name ?? menu.name,
        });
        if (dup && dup.id !== id) throw new ApiException('同级菜单名称已存在');
      }

      const oldAncestors = menu.ancestors;
      Object.assign(menu, dto, { parentId: nextParentId, ancestors });
      const saved = await repo.save(menu);
      if (!parentChanged) return saved;

      // 级联更新子孙：把祖先路径前缀 oldPrefix 换成 newPrefix
      const oldPrefix = `${oldAncestors},${menu.id}`;
      const newPrefix = `${ancestors},${menu.id}`;
      const descendants = await repo
        .createQueryBuilder('m')
        .where('(m.ancestors = :p OR m.ancestors LIKE :pc)', {
          p: oldPrefix,
          pc: `${oldPrefix},%`,
        })
        .getMany();
      for (const child of descendants) {
        child.ancestors = newPrefix + child.ancestors.slice(oldPrefix.length);
        await repo.save(child);
      }
      return saved;
    });
  }

  /** 删除菜单（软删除）；存在下级则拒绝 */
  async remove(id: number): Promise<boolean> {
    return this.txHost.withTransaction(async () => {
      const repo = this.txHost.tx.getRepository(Menu);
      const menu = await repo.findOneBy({ id });
      if (!menu) throw new NotFoundException(MSG_MENU_NOT_FOUND);
      const children = await repo.countBy({ parentId: id });
      if (children > 0) throw new ApiException('存在下级菜单，无法删除');
      await repo.softDelete(id);
      return true;
    });
  }
}
