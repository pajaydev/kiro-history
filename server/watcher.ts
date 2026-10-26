import { watch, type FSWatcher } from 'fs';

export interface FileWatcher {
  close: () => void;
}

export function watchFile(
  filePath: string,
  onChange: () => void
): FileWatcher {
  let debounceTimer: NodeJS.Timeout | null = null;
  let watcher: FSWatcher | null = null;

  const debouncedOnChange = () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      onChange();
    }, 500); // 500ms debounce
  };

  try {
    watcher = watch(filePath, (eventType) => {
      if (eventType === 'change') {
        debouncedOnChange();
      }
    });

    watcher.on('error', (error) => {
      console.error('File watcher error:', error);
    });
  } catch (error) {
    console.error('Failed to start file watcher:', error);
  }

  return {
    close: () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      if (watcher) {
        watcher.close();
        watcher = null;
      }
    },
  };
}

export interface WatchDirectoryOptions {
  /**
   * Watch subdirectories recursively. Defaults to true.
   * Set to false to watch only direct children of dirPath (e.g. to detect
   * top-level directory add/remove without reacting to writes deep inside).
   */
  recursive?: boolean;
}

export function watchDirectory(
  dirPath: string,
  onChange: (filename: string | null) => void,
  options: WatchDirectoryOptions = {}
): FileWatcher {
  const { recursive = true } = options;
  let debounceTimer: NodeJS.Timeout | null = null;
  let watcher: FSWatcher | null = null;
  // Remember the filename from the most recent event so the debounced
  // callback can pass it through (callers may filter on it).
  let lastFilename: string | null = null;

  const debouncedOnChange = () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      onChange(lastFilename);
    }, 300); // 300ms debounce for directory watching (reduced from 1s for faster updates)
  };

  try {
    watcher = watch(dirPath, { recursive }, (_eventType, filename) => {
      lastFilename = filename;
      debouncedOnChange();
    });

    watcher.on('error', (error) => {
      console.error('Directory watcher error:', error);
    });
  } catch (error) {
    console.error('Failed to start directory watcher:', error);
  }

  return {
    close: () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      if (watcher) {
        watcher.close();
        watcher = null;
      }
    },
  };
}
