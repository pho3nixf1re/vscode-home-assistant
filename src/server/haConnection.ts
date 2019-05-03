import * as ha from "home-assistant-js-websocket";
import { MarkedString, CompletionItem, CompletionItemKind, MarkupContent } from 'vscode-languageserver';
import { IConfigurationService } from "./ConfigurationService";
import ws = require("ws");
import {createSocket} from "./socket";

export interface IHaConnection {
    tryConnect(): Promise<void>;
    notifyConfigUpdate(conf: any);
    getEntityCompletions(): Promise<CompletionItem[]>;
}
export class HaConnection implements IHaConnection {

    private connection: ha.Connection | undefined;
    private hassEntities!: Promise<ha.HassEntities>;
    private hassServices!: Promise<ha.HassServices>;

    constructor(private configurationService: IConfigurationService, private logger: (message: string) => void) {

    }
    public tryConnect = async () => {
        await this.createConnection();
    }

    private isConnected = (): boolean => {
        return this.configurationService.isConfigured && this.connection !== undefined;
    }

    private async createConnection(): Promise<void> {

        if (this.isConnected()) {
            return;
        }

        let auth = new ha.Auth(<ha.AuthData>{
            access_token: `${this.configurationService.token}`,
            expires: +new Date(new Date().getTime() + 1e11),
            hassUrl: `${this.configurationService.url}`,
            clientId: "",
            expires_in: +new Date(new Date().getTime() + 1e11),
            refresh_token: ""
        });

        try {
            console.log("Connecting to Home Assistant...");
            this.connection = await ha.createConnection({
                auth: auth,
                createSocket: async (o) => createSocket(auth)
            });
        }
        catch (error) {
            this.handleConnectionError(error);
            throw error;
        }

        this.connection.addEventListener("ready", () => {
            console.log("(re-)connected to Home Assistant");
        });

        this.connection.addEventListener("disconnected", () => {
            console.warn("Lost connection with Home Assistant");
        });
        this.connection.addEventListener("reconnect-error", (data) => {
            console.error("Reconnect error with Home Assistant", data);
        });
    }

    private handleConnectionError = (error: any) => {
        this.connection = undefined;
        var tokenIndication = `${this.configurationService.token}`.substring(0, 5);
        var errorText = error;
        switch (error) {
            case 1:
                errorText = "ERR_CANNOT_CONNECT";
                break;
            case 2:
                errorText = "ERR_INVALID_AUTH";
                break;
            case 3:
                errorText = "ERR_CONNECTION_LOST";
                break;
            case 4:
                errorText = "ERR_HASS_HOST_REQUIRED";
                break;
        }
        let message = `Error connecting to your Home Assistant Server at ${this.configurationService.url} and token '${tokenIndication}...', check your network or update your VS Code Settings, make sure to (also) check your workspace settings! Error: ${errorText}`;
        console.error(message);
    }

    public notifyConfigUpdate = async (notifyConfigUpdate: any): Promise<void> => {
        this.disconnect();
        await this.tryConnect();
    }

    private getHassEntities = async (): Promise<ha.HassEntities> => {
        await this.createConnection();

        if (!this.hassEntities) {
            this.hassEntities = new Promise<ha.HassEntities>(async (resolve, reject) => {
                if (!this.connection) {
                    return reject();
                }
                ha.subscribeEntities(this.connection, entities => {
                    console.log(`Got ${Object.keys(entities).length} entities from Home Assistant`);
                    return resolve(entities);
                });
            });
        }
        return await this.hassEntities;
    }

    public async getEntityCompletions(): Promise<CompletionItem[]> {

        let entities = await this.getHassEntities();

        if (!entities) {
            return [];
        }

        let completions: CompletionItem[] = [];

        for (const [key, value] of Object.entries(entities)) {
            let completionItem = CompletionItem.create(`${value.entity_id}`);
            completionItem.kind = CompletionItemKind.EnumMember;
            completionItem.filterText = ` ${value.entity_id}`; // enable a leading space
            completionItem.insertText = completionItem.filterText;

            // completionItem.documentation = <MarkupContent>{
            //     kind: "markdown",
            //     value: `**${value.entity_id}** \r\n \r\n`
            // };

            // if (value.state) {
            //     completionItem.documentation.value += `State: ${value.state} \r\n \r\n`;
            // }
            // completionItem.documentation.value += `| Attribute | Value | \r\n`;
            // completionItem.documentation.value += `| :---- | :---- | \r\n`;

            // for (const [attrKey, attrValue] of Object.entries(value.attributes)) {
            //     completionItem.documentation.value += `| ${attrKey} | ${attrValue} | \r\n`;
            // }
            completions.push(completionItem);
        }
        return completions;
    }

    public disconnect() {
        if (!this.connection) {
            return;
        }
        console.log(`Disconnecting from Home Assistant`);
        this.connection.close();
        this.connection = undefined;
    }
}