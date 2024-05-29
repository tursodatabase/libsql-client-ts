import { http, HttpResponse } from "msw";

export const handlers = [
    http.get("ws://localhost:8080/v1/jobs", () => {
        return HttpResponse.json(
            { error: "Invalid namespace" },
            { status: 400 },
        );
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
