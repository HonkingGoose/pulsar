const { default: IntlMessageFormat } = require("intl-messageformat");
const { parse: parseToAST } = require("@formatjs/icu-messageformat-parser");

class Localisations {
  /**
   * @param {object} opts
   * @param {Array<string>} opts.locales
   */
  constructor({ locales }) {
    this.locales = locales;
    /** @type {{ [k: string]: PackageLocalisations }} */
    this.packages = {};
  }

  /**
   * @param {Key} _keystr
   * @param {Opts} opts
   */
  t(_keystr, opts = {}) {
    const i = _keystr.indexOf(".");
    if (i < 0) return fallback(_keystr, opts);

    const pkgName = _keystr.substring(0, i);
    const keystr = _keystr.substring(i + 1);
    return this.packages[pkgName]?.t(keystr, opts) ?? fallback(_keystr, opts);
  }

  /**
   * @param {object} opts
   * @param {string} opts.pkgName
   * @param {PackageStrings} opts.strings
   * @param {PackageASTCache} [opts.asts]
   */
  addPackage({ pkgName, strings, asts }) {
    this.packages[pkgName] = new PackageLocalisations({
      locales: this.locales,
      strings,
      asts
    });
  }
}

/**
 * manages strings of all languages for a single package
 * (in other words, manages `PackageLocalisations` instances)
 */
class PackageLocalisations {
  /**
   * @param {object} opts
   * @param {Array<string>} opts.locales
   * @param {PackageStrings} opts.strings
   * @param {PackageASTCache} [opts.asts]
   */
  constructor({ locales, strings: _strings, asts }) {
    this.locales = locales;
    /** @type {PackageASTCache} */
    this.asts = asts ?? {};
    /** @type {{ [k: string]: SingleLanguageLocalisations }} */
    this.localeObjs = {};

    for (const [locale, strings] of Object.entries(_strings)) {
      this.localeObjs[locale] = new SingleLanguageLocalisations({
        locale,
        strings,
        asts: (this.asts[locale] = this.asts[locale] ?? { items: {} })
      });
    }
  }

  /**
   * @param {Key} keystr
   * @param {Opts} opts
   */
  t(keystr, opts = {}) {
    for (const locale of this.locales) {
      const localised = this.localeObjs[locale]?.t(keystr, opts);
      if (localised) return localised;
    }
  }
}

/**
 * manages strings for a single locale of a single package
 */
// TODO someone please help me find a better name ~meadowsys
class SingleLanguageLocalisations {
  /**
   * @param {object} opts
   * @param {string} opts.locale
   * @param {Strings} opts.strings
   * @param {ASTCache} [opts.asts]
   */
  constructor({ locale, strings, asts }) {
    this.locale = locale;
    this.strings = strings;
    /** @type {ASTCache} */
    this.asts = asts ?? { items: {} };
    /** @type {FormatterCache} */
    this.formatters = {};
  }

  /**
   * @param {Key} keystr
   * @param {Opts} opts
   */
  t(keystr, opts = {}) {
    const key = keystr.split(".");
    guardPrototypePollution(key);

    const formatter = this._getFormatter(key);
    if (formatter) {
      const formatted = /** @type {string} */ (formatter.format(opts));
      return formatted;
    }
  }

  /**
   * @param {SplitKey} key
   */
  _getFormatter(key) {
    let value = this.formatters;

    const lastKeyPos = key.length - 1;
    for (let i = 0; i < lastKeyPos; i++) {
      const k = key[i];
      const v = value[k];

      if (!v) {
        /** @type {FormatterCache} */
        const cache = {};
        value[k] = cache;
        value = cache;
        continue;
      }
      if (v instanceof IntlMessageFormat) return;
      value = v;
    }

    const k = key[lastKeyPos];
    const v = value[k];

    if (!v) {
      const ast = this._getAST(key);
      if (!ast) return;

      const formatter = new IntlMessageFormat(ast.ast, this.locale);
      value[k] = formatter;
      return formatter;
    }

    if (v instanceof IntlMessageFormat) return v;
  }

  /**
   * @param {SplitKey} key
   */
  _getAST(key) {
    let value = this.asts;

    const lastKeyPos = key.length - 1;
    for (let i = 0; i < lastKeyPos; i++) {
      const k = key[i];
      const v = value.items[k];

      if (!v) {
        /** @type {ManyASTs} */
        const cache = { items: {} };
        value[k] = cache;
        value = cache;
        continue;
      }
      if (isAST(v)) return;
      value = v;
    }

    const k = key[lastKeyPos];
    const v = value.items[k];

    if (!v) {
      const string = this._getString(key);
      if (!string) return;

      /** @type {AST} */
      const ast = {
        ast: parseToAST(string)
      };

      value.items[k] = ast;
      return ast;
    }

    if (isAST(v)) return v;
  }

  /**
   * @param {SplitKey} key
   */
  _getString(key) {
    let value = this.strings;

    const lastKeyPos = key.length - 1;
    for (let i = 0; i < lastKeyPos; i++) {
      const k = key[i];
      const v = value[k];

      if (!v || typeof v === "string") return;
      value = v;
    }

    const k = key[lastKeyPos];
    const v = value[k];
    if (typeof v === "string") return v;
  }
}

/**
 * @param {OneOrManyASTs} obj
 * @return {obj is AST}
 */
function isAST(obj) {
  return "ast" in obj;
}

/**
 * @param {SplitKey} key
 */
function guardPrototypePollution(key) {
  if (key.includes("__proto__")) {
    throw new Error(`prototype pollution in key "${key.join(".")}" was detected and prevented`);
  }
}

/**
 * @param {Key} keystr
 * @param {Opts} opts
 */
function fallback(keystr, opts) {
  const optsArray = Object.entries(opts);
  if (optsArray.length === 0) return keystr;

  return `${keystr}: { ${
    optsArray
      .map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`)
      .join(", ")
  } }`;
}

/**
 * "basic" types
 * @typedef {import("@formatjs/icu-messageformat-parser").MessageFormatElement} MessageFormatElement
 * @typedef {{ ast: Array<MessageFormatElement> }} AST
 * @typedef {{ items: { [k: string]: OneOrManyASTs } }} ManyASTs
 * @typedef {AST | ManyASTs} OneOrManyASTs
 *
 * @typedef {string} Key
 * @typedef {Array<string>} SplitKey
 * @typedef {{ [k: string]: string }} Opts
 */
/**
 * types for `Localisations`
 * @typedef {{ [k: string]: PackageStrings }} AllStrings
 * @typedef {{ [k: string]: PackageASTCache }} AllAstCache
 */
/**
 * types for `PackageLocalisations`
 * @typedef {{ [k: string]: Strings }} PackageStrings
 * @typedef {{ [k: string]: ASTCache }} PackageASTCache
 */
/**
 * used in `SingleLanguageLocalisations`
 * @typedef {{ [k: string]: string | Strings }} Strings
 * @typedef {ManyASTs} ASTCache
 * @typedef {{ [k: string]: IntlMessageFormat | FormatterCache }} FormatterCache
 */
