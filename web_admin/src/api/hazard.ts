import { request } from './http';
import type {
  HazardAction,
  HazardDetail,
  HazardItem,
  JsonBody,
  PageResult,
  QueryOf,
} from './types';

export type HazardQuery = QueryOf<'HazardController_page_v1'>;
export type HazardReportBody = JsonBody<'HazardController_report_v1'>;
export type HazardAcceptBody = JsonBody<'HazardController_accept_v1'>;
export type HazardRejectBody = JsonBody<'HazardController_reject_v1'>;
export type HazardRectifyBody = JsonBody<'HazardController_rectify_v1'>;
export type HazardReviewBody = JsonBody<'HazardController_review_v1'>;
export type HazardArchiveBody = JsonBody<'HazardController_archive_v1'>;

/** 每个动作对应的权限码（与后端 HAZARD_TRANSITIONS[*].permission 同源） */
export const HAZARD_ACTION_PERMISSIONS: Record<HazardAction, string> = {
  REPORT: 'hazard:report:add',
  ACCEPT: 'hazard:report:accept',
  REJECT: 'hazard:report:reject',
  RECTIFY: 'hazard:report:rectify',
  REVIEW_PASS: 'hazard:report:review',
  REVIEW_BACK: 'hazard:report:review',
  ARCHIVE: 'hazard:report:archive',
};

export const hazardApi = {
  page: (params: Record<string, unknown>): Promise<PageResult<HazardItem>> =>
    request.get<PageResult<HazardItem>>('/hazard', params),
  detail: (id: number): Promise<HazardDetail> =>
    request.get<HazardDetail>(`/hazard/${id}`),
  report: (body: HazardReportBody): Promise<HazardItem> =>
    request.post<HazardItem>('/hazard', body),
  accept: (id: number, body: HazardAcceptBody): Promise<HazardItem> =>
    request.post<HazardItem>(`/hazard/${id}/accept`, body),
  reject: (id: number, body: HazardRejectBody): Promise<HazardItem> =>
    request.post<HazardItem>(`/hazard/${id}/reject`, body),
  rectify: (id: number, body: HazardRectifyBody): Promise<HazardItem> =>
    request.post<HazardItem>(`/hazard/${id}/rectify`, body),
  review: (id: number, body: HazardReviewBody): Promise<HazardItem> =>
    request.post<HazardItem>(`/hazard/${id}/review`, body),
  archive: (id: number, body: HazardArchiveBody): Promise<HazardItem> =>
    request.post<HazardItem>(`/hazard/${id}/archive`, body),
  remove: (id: number): Promise<boolean> =>
    request.delete<boolean>(`/hazard/${id}`),
};
