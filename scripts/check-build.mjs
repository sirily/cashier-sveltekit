import { pathToFileURL } from 'node:url';

export async function checkBuild(build, logger, output = console) {
	let warnings = 0;
	let forwardingDepth = 0;
	const originalWarn = logger.warn;
	const originalWarnOnce = logger.warnOnce;
	const consoleWarn = output.warn;

	try {
		logger.warn = (...args) => {
			if (forwardingDepth === 0) warnings += 1;
			forwardingDepth += 1;
			try {
				originalWarn.apply(logger, args);
			} finally {
				forwardingDepth -= 1;
			}
		};
		logger.warnOnce = (...args) => {
			if (forwardingDepth === 0) warnings += 1;
			forwardingDepth += 1;
			try {
				originalWarnOnce.apply(logger, args);
			} finally {
				forwardingDepth -= 1;
			}
		};
		output.warn = (...args) => {
			if (forwardingDepth === 0) warnings += 1;
			consoleWarn.apply(output, args);
		};

		await build(logger);
	} finally {
		output.warn = consoleWarn;
		logger.warn = originalWarn;
		logger.warnOnce = originalWarnOnce;
	}

	if (warnings > 0) {
		output.error(`Build completed with ${warnings} warning${warnings === 1 ? '' : 's'}.`);
		return 1;
	}

	return 0;
}

async function main() {
	const { createBuilder, createLogger } = await import('vite');
	const logger = createLogger('info');
	process.exitCode = await checkBuild(async (buildLogger) => {
		const builder = await createBuilder({ customLogger: buildLogger });
		await builder.buildApp();
	}, logger);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((error) => {
		console.error(error);
		process.exitCode = 1;
	});
}
