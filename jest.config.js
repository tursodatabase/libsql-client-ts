export default {
    preset: "ts-jest/presets/default-esm",
    moduleNameMapper: {
        '^(\\.{1,2}/.*)\\.js$': '$1',
    },
    testMatch: ["**/__tests__/*.test.[jt]s"],
}
