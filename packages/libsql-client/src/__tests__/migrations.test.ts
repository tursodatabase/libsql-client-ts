import { waitForLastMigrationJobToFinish } from "../migrations";
import { server } from "./mocks/node";

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("waitForLastMigrationJobToFinish()", () => {
    test("waits until the last job is completed", async () => {
        await waitForLastMigrationJobToFinish({
            authToken: "fake-auth-token",
            baseUrl: "http://fake-base-url.example.com",
        });
    });
});
