module.exports = {
  apps: [
    {
      name: "lamp-backend",
      script: "src/server.js",
      cwd: "C:/Backends By Shawqy/Lamp Test 01/Smart-Schedule-Lamp",
      node_args: "--enable-source-maps",
      env: {
        NODE_ENV: "production",
      },
      env_production: {
        PORT: 8080,
        WS_PATH: "/ws",
        MSSQL_SERVER: "localhost",
        MSSQL_PORT: 1433,
        MSSQL_DATABASE: "LampModulationDB",
        MSSQL_USER: "lamp_app",
        MSSQL_PASSWORD: "ChangeMe_Strong+Password_2025",
        MSSQL_ENCRYPT: "false",
        MSSQL_TRUST_SERVER_CERTIFICATE: "true",
        TRACKER_TICK_MS: 5000,
      },
    },
  ],
};
