import { rm } from "node:fs/promises";

function asError(error) {
  return error instanceof Error ? error : new Error(String(error));
}

function wrapCleanupError(label, error) {
  const cause = asError(error);
  return new Error(`${label} cleanup failed: ${cause.message}`, { cause });
}

export async function stopChildProcess(child) {
  if (!child || child.pid === undefined || child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  await new Promise((resolve, reject) => {
    let settled = false;
    const settle = (callback) => {
      if (settled) {
        return;
      }
      settled = true;
      child.removeListener("exit", handleExit);
      child.removeListener("error", handleError);
      callback();
    };
    const handleExit = () => settle(resolve);
    const handleError = (error) => settle(() => reject(error));

    child.once("exit", handleExit);
    child.once("error", handleError);

    if (child.exitCode !== null || child.signalCode !== null) {
      settle(resolve);
      return;
    }

    if (!child.kill()) {
      settle(() => reject(new Error(`Unable to terminate browser process ${child.pid}.`)));
    }
  });
}

export async function removeCaptureProfile(profilePath) {
  await rm(profilePath, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}

export async function runWithCaptureCleanup({ capture, closeBrowser, stopServer, removeProfile }) {
  let captureFailed = false;
  let primaryError;
  const cleanupErrors = [];

  try {
    await capture();
  } catch (error) {
    captureFailed = true;
    primaryError = error;
  } finally {
    for (const [label, cleanup] of [
      ["Browser process", closeBrowser],
      ["Vite server", stopServer],
      ["Browser profile", removeProfile],
    ]) {
      try {
        await cleanup();
      } catch (error) {
        cleanupErrors.push(wrapCleanupError(label, error));
      }
    }
  }

  if (captureFailed) {
    if (cleanupErrors.length === 0) {
      throw primaryError;
    }
    throw new AggregateError(
      [primaryError, ...cleanupErrors],
      `Capture failed and ${cleanupErrors.length} cleanup step${cleanupErrors.length === 1 ? "" : "s"} failed.`,
      { cause: asError(primaryError) },
    );
  }

  if (cleanupErrors.length === 1) {
    throw cleanupErrors[0];
  }
  if (cleanupErrors.length > 1) {
    throw new AggregateError(cleanupErrors, `${cleanupErrors.length} capture cleanup steps failed.`);
  }
}
