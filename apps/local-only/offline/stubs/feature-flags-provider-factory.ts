/**
 * Offline replacement for `FeatureFlagsProviderFactory`.
 *
 * Remote feature flags are an online control plane: they can turn features on
 * without the user asking. This build always reports "no flags", so nothing
 * upstream can be switched on by a server.
 */

import type { FeatureFlagsAndPayloads, FeatureFlagsSettings, IFeatureFlagsProvider } from "@/services/feature-flags/providers/IFeatureFlagsProvider";

const SETTINGS: FeatureFlagsSettings = { enabled: false, timeout: 0 };

export class LocalFeatureFlagsProvider implements IFeatureFlagsProvider {
	public async getAllFlagsAndPayloads(): Promise<FeatureFlagsAndPayloads | undefined> {
		return undefined;
	}

	public isEnabled(): boolean {
		return false;
	}

	public getSettings(): FeatureFlagsSettings {
		return SETTINGS;
	}

	public async dispose(): Promise<void> {}
}

export type FeatureFlagsProviderConfig = { type: "local" };

export class FeatureFlagsProviderFactory {
	public static createProvider(): IFeatureFlagsProvider {
		return new LocalFeatureFlagsProvider();
	}

	public static getDefaultConfig(): FeatureFlagsProviderConfig {
		return { type: "local" };
	}
}
