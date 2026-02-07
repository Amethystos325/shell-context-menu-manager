import { useEffect, useMemo, useState } from "react";
import type { LogEntry } from "./shared/ipc";
import "./App.css";

function formatErrorMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const errorLike = error as { code?: string; message?: string; details?: string };
    if (errorLike.code) {
      return `${errorLike.code}: ${errorLike.message ?? "Unknown error."}`;
    }
    if (errorLike.message) {
      return errorLike.message;
    }
  }

  return "Unknown error.";
}

function App() {
  const [appName, setAppName] = useState("Shell Context Menu Manager");
  const [appVersion, setAppVersion] = useState("-");
  const [filePath, setFilePath] = useState("");
  const [content, setContent] = useState("");
  const [status, setStatus] = useState("Ready");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let disposed = false;

    const init = async () => {
      try {
        const [appInfo, recentLogs] = await Promise.all([
          window.shellManager.getAppInfo(),
          window.shellManager.getRecentLogs(),
        ]);

        if (disposed) {
          return;
        }

        setAppName(appInfo.appName);
        setAppVersion(appInfo.appVersion);
        setFilePath(appInfo.defaultTestFilePath);
        setLogs(recentLogs);
      } catch (error) {
        if (!disposed) {
          setStatus(`Init failed: ${formatErrorMessage(error)}`);
        }
      }
    };

    void init();
    const unsubscribe = window.shellManager.onLog((entry) => {
      setLogs((prev) => [...prev.slice(-99), entry]);
    });

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  const isPathEmpty = useMemo(() => filePath.trim().length === 0, [filePath]);

  const handleRead = async () => {
    setBusy(true);
    try {
      const data = await window.shellManager.readTextFile({ path: filePath });
      setContent(data.content);
      setStatus(`Loaded: ${data.path}`);
    } catch (error) {
      setStatus(`Read failed: ${formatErrorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const handleWrite = async () => {
    setBusy(true);
    try {
      const data = await window.shellManager.writeTextFile({
        path: filePath,
        content,
      });
      setStatus(`Saved: ${data.path} (${data.bytes} bytes)`);
    } catch (error) {
      setStatus(`Save failed: ${formatErrorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <h1>{appName}</h1>
          <p>Stage 1 Scaffold | Version {appVersion}</p>
        </div>
        <div className="status-chip">{status}</div>
      </header>

      <section className="panel">
        <h2>IPC Test File</h2>
        <label htmlFor="file-path">Path</label>
        <input
          id="file-path"
          type="text"
          value={filePath}
          onChange={(event) => setFilePath(event.target.value)}
          placeholder="C:\\path\\to\\ipc-test.txt"
        />
        <div className="actions">
          <button type="button" onClick={handleRead} disabled={busy || isPathEmpty}>
            Read
          </button>
          <button type="button" onClick={handleWrite} disabled={busy || isPathEmpty}>
            Save
          </button>
        </div>
      </section>

      <section className="panel">
        <h2>Content</h2>
        <textarea
          value={content}
          onChange={(event) => setContent(event.target.value)}
          placeholder="Type test content here..."
        />
      </section>

      <section className="panel">
        <h2>Logs</h2>
        <div className="log-list">
          {logs.length === 0 ? (
            <p className="empty-tip">No logs yet.</p>
          ) : (
            logs
              .slice()
              .reverse()
              .map((log) => (
                <div className="log-row" key={log.id}>
                  <span className={`level level-${log.level}`}>{log.level.toUpperCase()}</span>
                  <span className="log-time">{log.time}</span>
                  <span className="log-message">{log.message}</span>
                </div>
              ))
          )}
        </div>
      </section>
    </main>
  );
}

export default App;
