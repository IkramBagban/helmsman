export const handleHealthRequest = (): Response => {
  return Response.json({
    ok: true,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
};
