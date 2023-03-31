import { expect } from "@jest/globals";
import type { MatcherFunction } from "expect";

import { LibsqlError } from "..";

const toBeLibsqlError: MatcherFunction<[code?: string, message?: RegExp]> =
    function (actual, code?, messageRe?) {
        const pass = actual instanceof LibsqlError
            && (code === undefined || actual.code === code)
            && (messageRe === undefined || actual.message.match(messageRe) !== null);

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

        return {pass, message};
    };

expect.extend({toBeLibsqlError});
declare module "expect" {
    interface AsymmetricMatchers {
        toBeLibsqlError(code?: string, messageRe?: RegExp): void;
    }
    interface Matchers<R> {
        toBeLibsqlError(code?: string, messageRe?: RegExp): R;
    }
}
