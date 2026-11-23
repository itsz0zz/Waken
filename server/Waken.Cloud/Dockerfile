# Waken accounts. Alpine + framework-dependent publish, like Waken.Api.
FROM --platform=$BUILDPLATFORM mcr.microsoft.com/dotnet/sdk:10.0.404-alpine3.24 AS build
WORKDIR /src
COPY Waken.Cloud.csproj .
RUN dotnet restore
COPY . .
RUN dotnet publish -c Release -o /app --no-restore -p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:10.0.15-alpine3.24
WORKDIR /app
COPY --from=build /app .
# The database and the token keys: the volume takes this directory's owner when Docker creates it.
RUN mkdir -p /data && chown -R "$APP_UID:$APP_UID" /data
USER $APP_UID
VOLUME /data
ENV ASPNETCORE_HTTP_PORTS=8080
EXPOSE 8080
ENTRYPOINT ["dotnet", "Waken.Cloud.dll"]
