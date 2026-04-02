"""
JSON 構造化ログユーティリティ

全ログを JSON 形式で stdout に出力する。
Docker / コンテナ環境でログ収集ツールが JSON を解析しやすいよう設計。

ログフォーマット例:
{
  "ts": "2024-01-15T12:34:56.789Z",
  "level": "INFO",
  "logger": "diff_jobs",
  "thread": "diff-job-a1b2c3d4",
  "msg": "phase_transition",
  "job_id": "a1b2c3d4-...",
  "phase": "finalizing",
  "prev_phase": "computing",
  "elapsed_s": 12.345,
  "left_map_remaining": 42
}
"""
import json
import logging
import sys
import threading
import time
from datetime import datetime, timezone
from typing import Any


# ── JSON フォーマッター ───────────────────────────────────────

class JsonFormatter(logging.Formatter):
    """
    logging.LogRecord を JSON 1行にシリアライズするフォーマッター。

    ログレコードの extra フィールドに渡した任意の dict が
    トップレベルキーとして出力されるため、構造化コンテキストを
    ロガー呼び出し元で自由に付与できる。
    """

    # LogRecord の標準属性（重複出力を避けるため除外）
    _SKIP = frozenset({
        "args", "created", "exc_info", "exc_text", "filename",
        "funcName", "levelname", "levelno", "lineno", "message",
        "module", "msecs", "msg", "name", "pathname", "process",
        "processName", "relativeCreated", "stack_info", "taskName",
        "thread", "threadName",
    })

    def format(self, record: logging.LogRecord) -> str:  # type: ignore[override]
        # 例外テキストを先に生成（record.message と別）
        exc_text: str | None = None
        if record.exc_info:
            exc_text = self.formatException(record.exc_info)

        doc: dict[str, Any] = {
            "ts":     datetime.fromtimestamp(record.created, tz=timezone.utc)
                      .strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z",
            "level":  record.levelname,
            "logger": record.name,
            "thread": record.threadName,
            "msg":    record.getMessage(),
        }

        # extra に渡された任意のキーを追記
        for key, val in vars(record).items():
            if key not in self._SKIP:
                doc[key] = val

        if exc_text:
            doc["exc"] = exc_text

        return json.dumps(doc, ensure_ascii=False, default=str)


# ── ロガーファクトリ ──────────────────────────────────────────

def get_logger(name: str) -> logging.Logger:
    """指定名のロガーを返す（初回呼び出し時に JsonFormatter を設定）"""
    return logging.getLogger(name)


# ── アプリ起動時に一度だけ呼ぶ ──────────────────────────────

def configure_logging(level: str = "INFO") -> None:
    """
    ルートロガーを JSON フォーマットで stdout に出力するよう設定する。
    main.py の lifespan 等で一度だけ呼ぶこと。
    """
    root = logging.getLogger()
    root.setLevel(getattr(logging, level.upper(), logging.INFO))

    # 既存ハンドラをクリア（uvicorn のデフォルトハンドラと二重出力を防ぐ）
    root.handlers.clear()

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root.addHandler(handler)

    # uvicorn 内部ロガーも JSON に統一
    for uv_name in ("uvicorn", "uvicorn.access", "uvicorn.error"):
        uv_logger = logging.getLogger(uv_name)
        uv_logger.propagate = True
        uv_logger.handlers.clear()


# ── ジョブスコープのタイマーロガー ───────────────────────────

class JobTimer:
    """
    差分ジョブ内で使う計時付きロガー。

    全ログに job_id を自動付与し、フェーズ境界では
    前フェーズ所要時間（elapsed_phase_s）とジョブ開始からの
    経過時間（elapsed_total_s）を合わせて出力する。

    使い方:
        timer = JobTimer(logger, job_id)
        timer.phase("fetching_left")
        timer.info("batch_complete", rows=5000, left_map_size=50000)
        timer.phase("computing")
        timer.warn("slow_batch", rows=100, elapsed_s=5.2)
    """

    def __init__(self, logger: logging.Logger, job_id: str) -> None:
        self._log        = logger
        self._job_id     = job_id
        self._job_start  = time.perf_counter()
        self._phase_start = self._job_start
        self._current_phase = "pending"

    # ── 内部ヘルパー ─────────────────────────────────────────

    def _elapsed_total(self) -> float:
        return round(time.perf_counter() - self._job_start, 3)

    def _elapsed_phase(self) -> float:
        return round(time.perf_counter() - self._phase_start, 3)

    def _emit(self, level: int, msg: str, **ctx: Any) -> None:
        extra = {
            "job_id":           self._job_id,
            "phase":            self._current_phase,
            "elapsed_total_s":  self._elapsed_total(),
            **ctx,
        }
        self._log.log(level, msg, extra=extra)

    # ── フェーズ遷移ログ ──────────────────────────────────────

    def phase(self, new_phase: str, **ctx: Any) -> None:
        """フェーズ遷移を記録。前フェーズの所要時間も出力する。"""
        elapsed = self._elapsed_phase()
        extra = {
            "job_id":            self._job_id,
            "phase":             new_phase,
            "prev_phase":        self._current_phase,
            "elapsed_phase_s":   elapsed,
            "elapsed_total_s":   self._elapsed_total(),
            **ctx,
        }
        self._log.info("phase_transition", extra=extra)
        self._current_phase = new_phase
        self._phase_start   = time.perf_counter()

    # ── 通常ログ ─────────────────────────────────────────────

    def info(self, msg: str, **ctx: Any) -> None:
        self._emit(logging.INFO, msg, **ctx)

    def warn(self, msg: str, **ctx: Any) -> None:
        self._emit(logging.WARNING, msg, **ctx)

    def error(self, msg: str, **ctx: Any) -> None:
        self._emit(logging.ERROR, msg, **ctx)

    def debug(self, msg: str, **ctx: Any) -> None:
        self._emit(logging.DEBUG, msg, **ctx)

    # ── タイミング計測ブロック ────────────────────────────────

    def timed(self, label: str, **ctx: Any) -> "TimedBlock":
        """
        with timer.timed("del_left_map", size=len(left_map)):
            del left_map
        のように使うコンテキストマネージャ。完了時に elapsed_s を INFO 出力する。
        """
        return TimedBlock(self, label, ctx)


class TimedBlock:
    """JobTimer.timed() が返すコンテキストマネージャ。"""

    def __init__(self, timer: JobTimer, label: str, ctx: dict) -> None:
        self._timer = timer
        self._label = label
        self._ctx   = ctx
        self._start = 0.0

    def __enter__(self) -> "TimedBlock":
        self._start = time.perf_counter()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        elapsed = round(time.perf_counter() - self._start, 4)
        if exc_type is None:
            self._timer.info(self._label, elapsed_s=elapsed, **self._ctx)
        else:
            self._timer.error(
                f"{self._label}_error",
                elapsed_s=elapsed,
                error=str(exc_val),
                **self._ctx,
            )
