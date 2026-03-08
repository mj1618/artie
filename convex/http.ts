import { httpRouter } from "convex/server";

const http = httpRouter();

// No callback endpoints needed — Particle VMs are managed via API polling

export default http;
