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

export function watchDirectory(
  dirPath: string,
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
    }, 1000); // 1s debounce for directory watching
  };

  try {
    watcher = watch(dirPath, { recursive: true }, (_eventType, _filename) => {
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
