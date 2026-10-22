/**
 * Offline replacement for `ErrorProviderFactory`.
 *
 * Errors stay on the machine: they are written to the local Cline output
 * channel instead of an error-reporting service, and the PostHog error client
 * never enters the bundle.
 */

import { Logger } from "@/shared/services/Logger";
import type { IErrorProvider, ErrorSettings } from "@/services/error/providers/IErrorProvider";

const SETTINGS: ErrorSettings = { enabled: false, hostEnabled: false, level: "off" };

export class LocalErrorProvider implements IErrorProvider {
	public async captureException(error: Error | { message?: string; stack?: string }): Promise<void> {
		Logger.error(`[cline-local] ${error?.message ?? "error"}`, error?.stack);
	}

	public logException(error: Error | { message?: string }): void {
		Logger.error(`[cline-local] ${error?.message ?? "error"}`);
	}

	public logMessage(message: string, level: "error" | "warning" | "log" | "debug" | "info" = "info"): void {
		if (level === "error") Logger.error(`[cline-local] ${message}`);
		else if (level === "warning") Logger.warn(`[cline-local] ${message}`);
		else Logger.info(`[cline-local] ${message}`);
	}

	public isEnabled(): boolean {
		return false;
	}

	public getSettings(): ErrorSettings {
		return SETTINGS;
	}

	public async dispose(): Promise<void> {}
}

export type ErrorProviderConfig = { type: "local" };

export class ErrorProviderFactory {
	public static async createProvider(): Promise<IErrorProvider> {
		return new LocalErrorProvider();
	}

	public static getDefaultConfig(): ErrorProviderConfig {
		return { type: "local" };
	}
}
