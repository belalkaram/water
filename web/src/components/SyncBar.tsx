import React from 'react';
import { dismissNotices, isIos, type SyncState } from '../offline/sync';

interface Props {
  online: boolean;
  /** the plan on screen comes from what was saved on the phone (no internet) */
  usingSaved: boolean;
  sync: SyncState;
  onUploadNow: () => void;
}

const NOTICE_LABEL: Record<string, string> = {
  cancelled: 'اتلغت',
  conflict: 'تعارض',
  rejected: 'اترفضت',
  skipped: 'ما اترفعتش',
};

/** Strip under the top bar: offline state, inspections waiting on the phone, and what happened to uploads. */
export const SyncBar: React.FC<Props> = ({ online, usingSaved, sync, onUploadNow }) => {
  const { pending, uploading, notices } = sync;
  if (online && !pending && !notices.length) return null;

  return (
    <div className="sync-bar">
      {!online && (
        <div className="sync-row sync-offline">
          <b>⚠️ مفيش اتصال بالإنترنت</b>
          <span>
            {usingSaved ? 'بتشتغل على الخطة المحفوظة على التليفون. ' : ''}
            تقدر تسجل المعاينات عادي وهتتحفظ على التليفون.
          </span>
        </div>
      )}

      {pending > 0 && (
        <div className="sync-row sync-pending">
          <span className="sync-count">{pending}</span>
          <span style={{ flex: 1, minWidth: 0 }}>
            {pending === 1 ? 'معاينة محفوظة على التليفون' : 'معاينات محفوظة على التليفون'} — في انتظار الرفع
            {online
              ? uploading
                ? ' (جارٍ الرفع…)'
                : ''
              : isIos()
              ? '. على الآيفون: افتح البرنامج بعد ما النت يرجع عشان تترفع.'
              : '. هتترفع لوحدها أول ما النت يرجع.'}
          </span>
          {online && !uploading && (
            <button type="button" className="sync-btn" onClick={onUploadNow}>
              رفع الآن
            </button>
          )}
        </div>
      )}

      {notices.length > 0 && (
        <div className="sync-row sync-notices">
          <div style={{ flex: 1, minWidth: 0 }}>
            {notices.slice(-5).map((n) => (
              <div key={n.id} className="text-wrap">
                <b>{NOTICE_LABEL[n.status] || n.status}:</b> {n.facility_name} — {n.reason}
              </div>
            ))}
          </div>
          <button type="button" className="sync-btn" onClick={() => dismissNotices()}>
            تمام
          </button>
        </div>
      )}
    </div>
  );
};
