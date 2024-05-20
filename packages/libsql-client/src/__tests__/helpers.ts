import { expect } from "@jest/globals";
import type { MatcherFunction } from "expect";

import { LibsqlError } from "../node.js";

type CodeMatch = {
    code: string;
    rawCode: number;
};

const toBeLibsqlError: MatcherFunction<
    [code?: string | CodeMatch, message?: RegExp]
> = function (actual, code?, messageRe?) {
    const pass =
        actual instanceof LibsqlError &&
        isValidCode(actual, code) &&
        (messageRe === undefined || actual.message.match(messageRe) !== null);

    const message = (): string => {
        const parts = [];
        parts.push("expected ");
        parts.push(this.utils.printReceived(actual));
        parts.push(pass ? " not to be " : " to be ");
        parts.push("an instance of LibsqlError");
        if (code !== undefined) {
            parts.push(" with error code ");
            parts.push(this.utils.printExpected(code));
        }
        if (messageRe !== undefined) {
            parts.push(" with error message matching ");
            parts.push(this.utils.printExpected(messageRe));
        }
        return parts.join("");
    };

    return { pass, message };
};

const isValidCode = (error: LibsqlError, code?: string | CodeMatch) => {
    if (code === undefined) {
        return true;
    }
    if (typeof code === "string") {
        return error.code === code;
    }
    return error.code === code.code && error.rawCode === code.rawCode;
};
expect.extend({ toBeLibsqlError });
declare module "expect" {
    interface AsymmetricMatchers {
        toBeLibsqlError(code?: string | CodeMatch, messageRe?: RegExp): void;
    }
    interface Matchers<R> {
        toBeLibsqlError(code?: string | CodeMatch, messageRe?: RegExp): R;
    }
}
