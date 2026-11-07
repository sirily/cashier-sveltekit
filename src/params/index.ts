import { defineParams } from '@sveltejs/kit/params';

export const params = defineParams({
	exportType: (param) => (param === 'journal' ? param : undefined)
});
