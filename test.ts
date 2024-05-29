const libsqlClient = require("./packages/libsql-client");
const createClient = libsqlClient.createClient;

//const client = createClient({
//url: "libsql://schema-db-test-giovannibenussiparedes.turso.io",
//authToken:
//"eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE3MTQ0ODYzMjAsImlkIjoiMWVjNGY3ZTktNzY3NC00NzEzLWEzYjAtNWM4NzFjNjZlZGQ1In0.lzim2HBCf3W-tnDUwRzeHQz0nbOA_L2D8v_ahfuw_PVq_teuqyFGE0tUgiM_HIvVo6xDdGFQGKj6dFHhLAwrDw",
//});
const schemaUrl = "libsql://schema-test-giovannibenussi.turso.io";
const schemaAuthToken =
    "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE3MTU2ODIwMTAsImlkIjoiM2IyYTIwMDEtOTcxZC00MzIzLWE2YWYtMjk1YTRmOWNkYzVkIn0.l-LzYur2KffpkrZog5vT3eThwB3m2Nl0RIgc5rLn1DpBsYyWujPTkpS62WoYBwWbM0AMaAoRqfyCzi-T-LnJBQ";

const normalClient = createClient({
    url: "libsql://libsql-client-test-giovannibenussi.turso.io",
    authToken:
        "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE3MTY5ODc2MDgsImlkIjoiNjhlNzI2M2ItNGQxMi00NWJhLWIxYWYtZGRjZmFhN2I5MTY0In0.PCMMgoOVxnh-Aj10urzsMpXH1anzcmng_Q0ByXIz_E9zHMZide3NAgeVzDg52q3DgHbMndoid_qv1ULjsChMAg",
});

const childClient = createClient({
    url: "libsql://schema-child-1-giovannibenussi.turso.io",
    authToken:
        "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE3MTU2ODE0MDIsImlkIjoiYjJhYjRhNjQtNDAyYy00YmRmLWExZTgtMjdlZjMzNTE4Y2JkIn0.Og9E7nl_Y8P93FO1XJlvAhkKEOsGynDdFEziJwLeGrMNaAOhQLqdxk7shao13VQo4JVFkMuSTXMibKXuPnavBA",
});

const schemaClient = createClient({
    url: schemaUrl,
    authToken: schemaAuthToken,
});

async function main() {
    //await schemaClient.execute(
    //"ALTER TABLE users ADD COLUMN test_column_18 number;",
    //);
    await schemaClient.batch([
        "ALTER TABLE users ADD COLUMN test_column_19 number;",
    ]);
}

main();
