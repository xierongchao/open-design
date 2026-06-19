import { useEffect, useState } from 'react';
import { RemixIcon } from './RemixIcon';

interface EditorDiagnosticsRecorderButtonProps {
  fileName?: string;
  className?: string;
}

const START_LABEL = '录制操作诊断';
const STOP_LABEL = '停止录制并下载诊断 JSON';

export function EditorDiagnosticsRecorderButton({
  fileName,
  className = '',
}: EditorDiagnosticsRecorderButtonProps) {
  const [recording, setRecording] = useState(false);

  useEffect(() => {
    const controller = diagnosticsController();
    setRecording(Boolean(controller?.report().active));
  }, []);

  const label = recording ? STOP_LABEL : START_LABEL;

  return (
    <button
      type="button"
      className={`viewer-action viewer-action-icon editor-diagnostics-recorder od-tooltip${recording ? ' active recording' : ''}${className ? ` ${className}` : ''}`}
      aria-label={label}
      aria-pressed={recording}
      data-tooltip={label}
      data-tooltip-placement="bottom"
      title={label}
      onClick={() => {
        const controller = diagnosticsController();
        if (!controller) return;
        if (recording) {
          controller.record('diagnostics-recording:stopping', { fileName });
          controller.stop();
          controller.download(buildDiagnosticsFileName(fileName));
          setRecording(false);
          return;
        }
        controller.start({
          includeStacks: true,
          captureOperations: true,
          reset: true,
        });
        controller.record('diagnostics-recording:started', { fileName });
        setRecording(true);
      }}
    >
      <RemixIcon name={recording ? 'stop-circle-line' : 'record-circle-line'} size={15} />
    </button>
  );
}

function diagnosticsController() {
  if (typeof window === 'undefined') return undefined;
  return window.__OD_EDITOR_DIAGNOSTICS__;
}

function buildDiagnosticsFileName(fileName: string | undefined): string {
  const safeFileName = (fileName ?? 'session')
    .replace(/\.[^.]+$/, '')
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'session';
  return `open-design-operation-recording-${safeFileName}-${Date.now()}.json`;
}
