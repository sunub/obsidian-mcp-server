const MIN_STEM_LENGTH = 2;
const ENDS_WITH_HANGUL = /[가-힣]$/;

const JOSA_SUFFIXES = [
	"으로써",
	"으로서",
	"에게서",
	"에서는",
	"에서도",
	"으로는",
	"에게는",
	"이라는",
	"이라고",
	"에서",
	"으로",
	"에게",
	"까지",
	"부터",
	"처럼",
	"보다",
	"마다",
	"이나",
	"이란",
	"라는",
	"라고",
	"한테",
	"은",
	"는",
	"이",
	"가",
	"을",
	"를",
	"의",
	"에",
	"로",
	"와",
	"과",
	"도",
	"만",
	"란",
].sort((a, b) => b.length - a.length);

export function stripJosa(token: string): string {
	if (!ENDS_WITH_HANGUL.test(token)) return token;
	const suffix = JOSA_SUFFIXES.find((candidate) => token.endsWith(candidate));
	if (suffix === undefined) return token;
	const stem = token.slice(0, -suffix.length);
	return stem.length >= MIN_STEM_LENGTH ? stem : token;
}
