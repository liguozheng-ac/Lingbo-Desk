import { Plugin } from 'vite';

declare function DownloadLive2DSDK(options?: {
    from?: string;
}): Plugin;

export { DownloadLive2DSDK };
