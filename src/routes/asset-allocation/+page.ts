import { loadAssetAllocation } from '#lib/assetAllocation/loadAssetAllocation';
import Notifier from '#lib/utils/notifier';
import { AppError } from '#lib/utils/errors';

export async function load() {
	try {
		const aa = await loadAssetAllocation();
		if (aa.warnings.length > 0) {
			const warningMsg =
				aa.warnings.length === 1
					? aa.warnings[0]
					: `${aa.warnings.length} commodities not mapped to asset classes. Check console for details.`;
			Notifier.warning(warningMsg);
			console.warn('Asset Allocation warnings:', aa.warnings);
		}
		return { aa, loadError: undefined };
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		const action = error instanceof AppError && error.action;
		return { aa: undefined, loadError: action ? `${reason} ${action}` : reason };
	}
}
