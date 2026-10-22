/**
 * Offline replacement for `TelemetryProviderFactory`.
 *
 * The build aliases `@services/telemetry/TelemetryProviderFactory` here, which
 * removes PostHog and OpenTelemetry from the bundle: no client is constructed,
 * so there is no flush interval, no batch queue and no exporter endpoint. The
 * TelemetryService itself is upstream code and stays in place, it simply ends
 * up with zero providers, which it already supports.
 */

import type { ITelemetryProvider, TelemetryProperties } from "@/services/telemetry/providers/ITelemetryProvider";

export type TelemetryProviderConfig = { type: "none" };

export class OfflineTelemetryProvider implements ITelemetryProvider {
	public constructor(private readonly name: string) {}

	public log(_event: string, _properties?: TelemetryProperties): void {}
	public logRequired(_event: string, _properties?: TelemetryProperties): void {}
	public identifyUser(): void {}
	public isEnabled(): boolean {
		return false;
	}
	public getSettings() {
		return { hostEnabled: false, level: "off" as const };
	}
	public recordCounter(): void {}
	public recordHistogram(): void {}
	public recordGauge(): void {}
	public async forceFlush(): Promise<void> {}
	public async dispose(): Promise<void> {}
}

export class TelemetryProviderFactory {
	public static async createProviders(): Promise<ITelemetryProvider[]> {
		return [];
	}

	public static getDefaultConfigs(): TelemetryProviderConfig[] {
		return [{ type: "none" }];
	}

	public static async createProvider(): Promise<ITelemetryProvider> {
		return new OfflineTelemetryProvider("cline-local-offline");
	}
}
