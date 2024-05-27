import { http, HttpResponse } from "msw";

export const handlers = [
    http.get("http://fake-base-url.example.com/v1/jobs", () => {
        return HttpResponse.json({
            schema_version: 4,
            migrations: [
                { job_id: 4, status: "WaitingDryRun" },
                { job_id: 3, status: "RunSuccess" },
                { job_id: 2, status: "RunSuccess" },
                { job_id: 1, status: "RunSuccess" },
            ],
        });
    }),

    http.get(
        "http://fake-base-url.example.com/v1/jobs/:job_id",
        ({ params }) => {
            const { job_id } = params;

            return HttpResponse.json({
                job_id,
                status: "RunSuccess",
                progress: [
                    {
                        namespace: "b2ab4a64-402c-4bdf-a1e8-27ef33518cbd",
                        status: "RunSuccess",
                        error: null,
                    },
                ],
            });
        },
    ),
];
