import { ApiOkResponse, type SchemaObject } from '@nestjs/swagger';
import { z } from 'zod';

/**
 * 响应契约（OpenAPI）声明工具 —— 前后端类型自动化的唯一出口。
 *
 * 设计要点：
 * 1. **声明在控制器上**：每个接口用 `@ApiOkZod('组件名', dataSchema, '说明')` 标注，
 *    组件写入 `components.schemas`，接口响应用 `$ref` 引用（见 setup-swagger.ts）。
 * 2. **包络统一**：真实响应是 `{ code, msg, data }`（TransformInterceptor 包装），
 *    这里自动补包络，调用方只描述 `data`。
 * 3. **同一份 schema 既生成文档又做契约测试**：`getResponseZodSchemas()` 暴露给
 *    e2e（test/contract.e2e-spec.ts）校验真实返回，schema 漂移会直接测试失败。
 * 4. **方言**：复用 Zod 的 Standard JSON Schema（`~standard.jsonSchema`，target
 *    `openapi-3.0`），与 Nest 12 转换请求体的通道一致（`nullable` / `exclusiveMinimum`
 *    等均为 3.0 语义）。
 * 5. **递归树**（部门/菜单）：Zod 用 `$ref: '#'` 表达自引用；若直接内联进包络，
 *    `#` 会指向包络根而不是节点。因此检测到自引用时，把 data 单独抽成组件
 *    `<名字>Data` 并用 `$ref` 引用，保证指针正确、工具链可解析。
 */

type JsonSchema = Record<string, unknown>;

interface RegisteredResponse {
  /** 完整包络的 zod schema（契约测试用） */
  zod: z.ZodType;
  /** 包络的 JSON Schema（接口响应用） */
  json: JsonSchema;
  /** 需额外注入的组件（递归数据体） */
  extra: Array<[string, JsonSchema]>;
}

/** 组件名 → 响应定义（控制器加载时填充，setupSwagger 时注入文档） */
const registry = new Map<string, RegisteredResponse>();

/** 统一响应包络（契约测试用） */
function envelope<T extends z.ZodType>(data: T) {
  return z.object({ code: z.number(), msg: z.string(), data });
}

/** 是否存在自引用 */
function hasSelfRef(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasSelfRef);
  if (value && typeof value === 'object') {
    return Object.entries(value).some(([key, val]) =>
      key === '$ref' ? val === '#' : hasSelfRef(val),
    );
  }
  return false;
}

/** Zod → OpenAPI 3.0 JSON Schema；失败在模块加载期就暴露 */
function toOpenApi30(schema: z.ZodType): JsonSchema {
  const standard = (
    schema as unknown as {
      '~standard'?: {
        jsonSchema?: Record<string, (opts: { target: string }) => unknown>;
      };
    }
  )['~standard'];
  const convert = standard?.jsonSchema?.output;
  if (!convert) {
    throw new Error('[api-ok] 该 schema 不支持 Standard JSON Schema 转换');
  }
  return convert({ target: 'openapi-3.0' }) as JsonSchema;
}

/** 手工构造包络，避免 3.0 不支持 `type: 'null'` */
function buildEnvelope(dataJson: JsonSchema | null): JsonSchema {
  return {
    type: 'object',
    properties: {
      code: { type: 'integer', example: 200, description: '业务码，200 表示成功' },
      msg: { type: 'string', example: '操作成功', description: '提示信息' },
      data: dataJson ?? { nullable: true, description: '无返回体时为 null' },
    },
    required: ['code', 'msg'],
  };
}

/**
 * 把 `data` 部分整理成可直接放进文档的形状。
 *
 * Zod 对递归结构有两种产出：
 * - 对象自引用：`{ $ref: '#' }`（# 指自身）
 * - 数组套递归：`{ items: { $ref: '#/definitions/X' }, definitions: { X: ... } }`
 *
 * 两种都不能内联进包络（`#` 会指错根、`definitions` 在 OpenAPI 3.0 里没有位置），
 * 因此统一抽成 `components.schemas`：
 * - 对象自引用 → 组件 `<名字>Data`，接口用 `$ref` 引用；
 * - 数组套单个递归节点 → 组件 `<名字>Data` 存节点，接口保留数组壳。
 */
function extractBody(
  name: string,
  raw: JsonSchema,
  extra: Array<[string, JsonSchema]>,
): JsonSchema {
  const defsKey = raw.$defs ? '$defs' : raw.definitions ? 'definitions' : null;
  const defs = defsKey ? ((raw[defsKey] ?? {}) as Record<string, JsonSchema>) : {};
  const keys = Object.keys(defs);
  const selfRef = hasSelfRef(raw);

  if (!defsKey && !selfRef) return raw;

  const dataName = `${name}Data`;
  const dataRef = `#/components/schemas/${dataName}`;
  // 数组套单个递归节点：该节点就是 Data 组件，数组壳留在接口上
  const singleDef = !selfRef && keys.length === 1 ? keys[0] : null;

  const refMap = new Map<string, string>();
  for (const key of keys) {
    const target =
      singleDef === key ? dataRef : `#/components/schemas/${name}Data_${key}`;
    refMap.set(`#/definitions/${key}`, target);
    refMap.set(`#/$defs/${key}`, target);
  }

  const rewrite = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(rewrite);
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(value)) {
        if (key === '$ref' && typeof val === 'string') {
          if (val === '#') {
            out[key] = dataRef;
            continue;
          }
          out[key] = refMap.get(val) ?? val;
          continue;
        }
        out[key] = rewrite(val);
      }
      return out;
    }
    return value;
  };

  const body = { ...raw } as JsonSchema;
  if (defsKey) delete body[defsKey];

  if (singleDef) {
    extra.push([dataName, rewrite(defs[singleDef]) as JsonSchema]);
    return rewrite(body) as JsonSchema;
  }

  extra.push([dataName, rewrite(body) as JsonSchema]);
  return { $ref: dataRef };
}

/**
 * 组件名即前后端共享的契约名：同名必须同结构，否则前端类型会被悄悄覆盖。
 * 这里在模块加载期直接炸掉（而不是生成一份错误的文档）。
 */
function assertUnique(
  name: string,
  json: JsonSchema,
  extra: Array<[string, JsonSchema]>,
): void {
  const existing = registry.get(name);
  if (!existing) return;
  const same =
    JSON.stringify(existing.json) === JSON.stringify(json) &&
    JSON.stringify(existing.extra) === JSON.stringify(extra);
  if (!same) {
    throw new Error(`[api-ok] 响应组件重名但结构不同: ${name}`);
  }
}

/**
 * 注册一个响应组件，返回 `$ref` 字符串。
 * @param name 组件名（PascalCase，全局唯一）
 * @param data data 字段的 schema；无返回体传 null
 */
export function responseSchema(name: string, data: z.ZodType | null): string {
  const ref = `#/components/schemas/${name}`;
  const extra: Array<[string, JsonSchema]> = [];

  if (!data) {
    const emptyJson = buildEnvelope(null);
    assertUnique(name, emptyJson, extra);
    registry.set(name, { zod: envelope(z.null()), json: emptyJson, extra });
    return ref;
  }

  const inline = extractBody(name, toOpenApi30(data), extra);

  const json = buildEnvelope(inline);
  assertUnique(name, json, extra);
  registry.set(name, { zod: envelope(data), json, extra });
  return ref;
}

/**
 * 成功响应声明（替代 `@ApiOkResponse({ description })`）。
 *
 * 用法：
 *   @ApiOkZod('SysUser', userResponseSchema, '创建用户')
 *   @ApiOkZod('SysUserPage', pageOf(userResponseSchema), '分页查询用户')
 *   @ApiOkZod('BoolResult', null, '删除成功')
 */
export function ApiOkZod(
  name: string,
  data: z.ZodType | null,
  description = '',
): MethodDecorator & ClassDecorator {
  const ref = responseSchema(name, data);
  return ApiOkResponse({
    description,
    schema: { $ref: ref } as unknown as SchemaObject,
  });
}

/** 分页包络 `{ list, total }` */
export function pageOf<T extends z.ZodType>(item: T) {
  return z.object({ list: z.array(item), total: z.number() });
}

/** 供 setupSwagger 注入 components.schemas（含递归数据体组件） */
export function getResponseSchemas(): Array<[string, JsonSchema]> {
  const out: Array<[string, JsonSchema]> = [];
  for (const [name, entry] of registry) {
    out.push([name, entry.json], ...entry.extra);
  }
  return out;
}

/** 供 e2e 契约测试校验真实响应 */
export function getResponseZodSchemas(): ReadonlyMap<string, z.ZodType> {
  return new Map([...registry.entries()].map(([name, entry]) => [name, entry.zod]));
}
