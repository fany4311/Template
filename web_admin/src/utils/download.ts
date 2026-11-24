import { ElMessage } from 'element-plus';
import { http } from '../api/http';

/**
 * 下载受保护的文件。
 *
 * 为什么不直接 `window.open(downloadUrl)`：
 * 下载接口要 `Authorization` 头，而浏览器窗口 / `<a href>` 发的是无凭证导航请求。
 * 所以用 axios 拿 blob 再触发本地保存 —— 鉴权、审计、防盗链全都还能生效。
 *
 * 文件名由调用方传入（来自接口返回的 `originalName`，UTF-8 正常）：
 * 走 axios 拦截器后拿到的是 Blob 本身，拿不到响应头。
 */
export async function downloadFile(
  url: string,
  filename = 'download',
): Promise<void> {
  try {
    const blob = await http.get(url, { responseType: 'blob' });
    saveBlob(blob as unknown as Blob, filename);
  } catch {
    // 错误体也是 blob，拦截器读不到 msg，这里统一兜底提示
    ElMessage.error('下载失败，请稍后重试');
  }
}

/**
 * 下载带查询条件的导出（CSV）。
 *
 * 与 downloadFile 的区别：
 * 1. 要带筛选参数（keyword/status），文件名由前端拼（后端没有暴露响应头）；
 * 2. 后端业务异常仍是 HTTP 200 + JSON，responseType 为 blob 时拿到的是
 *    「装着 JSON 的 Blob」—— 不判一下，用户会下载到一个内容是报错信息的 .csv。
 */
export async function downloadCsv(
  url: string,
  params: Record<string, unknown>,
  filename: string,
): Promise<void> {
  let blob: Blob;
  try {
    blob = (await http.get(url, {
      params,
      responseType: 'blob',
      timeout: 60_000,
    })) as unknown as Blob;
  } catch {
    ElMessage.error('导出失败，请稍后重试');
    return;
  }

  if (blob.type.includes('json')) {
    const body = JSON.parse(await blob.text()) as { msg?: string };
    ElMessage.error(body.msg || '导出失败');
    return;
  }
  saveBlob(blob, filename);
}

/** 触发浏览器另存为 */
export function saveBlob(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 立即释放会让部分浏览器下载中断，延迟回收
  setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
}
