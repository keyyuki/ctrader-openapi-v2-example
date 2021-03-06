import { Codec } from './Codec';
import * as tls from 'tls';
import * as hat from 'hat';
import { EventEmitter } from 'events';
import { Subject, interval } from 'rxjs';
import { Command } from './Command';

const protocol = new Codec();

type CtraderApiConnectParam = {
  host: string;
  port: number;
};
export class CtraderApiConnect extends EventEmitter {
  isConnected = false;
  adapter: tls.TLSSocket;
  connectState$: Subject<boolean>;

  commandStack: Array<Command> = [];

  constructor(params: CtraderApiConnectParam) {
    super();
    this.connectState$ = new Subject();
    this.connectState$.subscribe(isConnected => {
      if (isConnected) {
        this.resend();
      }
    });

    this.adapter = tls
      .connect({ host: params.host, port: params.port }, () => {
        protocol
          .loadFromFiles([
            'message-model/OpenApiCommonMessages.proto',
            'message-model/OpenApiMessages.proto',
          ])
          .then(() => {
            this.isConnected = true;
            this.connectState$.next(this.isConnected);
            console.log('init complete');
          });
      })
      .setEncoding('binary')
      .setDefaultEncoding('binary');

    this.adapter.on('data', this.onAdapterData);
    this.adapter.on('end', () => {
      this.isConnected = false;
      this.connectState$.next(this.isConnected);
    });
    this.adapter.on('error', () => {
      this.isConnected = false;
      this.connectState$.next(this.isConnected);
    });

    // clean timeout command
    interval(5 * 60 * 1000).subscribe(() => {
      this.commandStack = this.commandStack.filter(
        item => item.status != 'timeout',
      );
    });
  }

  // use to resend command that push when system does not ready
  resend = (): void => {
    if (this.commandStack.length) {
      for (let i = 0; i < this.commandStack.length; i++) {
        const command = this.commandStack[i];
        if (command.status == 'new') {
          command.markAsSent();
          const encodedMessage = this.encodeMessage(
            command.message.type,
            command.message.message,
            command.message.clientMsgId,
          );
          this.adapter.write(encodedMessage);
        }
      }
    }
  };

  // exchange Socket::write -> request-response
  send = (type: string, message: any): Promise<any> => {
    // get type
    const clientMsgId = hat();

    const command = new Command(clientMsgId, { type, message, clientMsgId });
    if (this.isConnected) {
      command.markAsSent();
      const encodedMessage = this.encodeMessage(type, message, clientMsgId);
      this.adapter.write(encodedMessage);
    }
    this.commandStack.push(command);
    return command.promise;
  };

  encodeMessage = (
    payloadType: string,
    payload: any,
    clientMsgId?: string,
  ): Buffer => {
    return protocol.encode(payloadType, payload, clientMsgId || hat());
  };

  onAdapterData = (buffer: string): void => {
    let data: any;

    try {
      data = protocol.decode(buffer);
    } catch (error) {
      console.log(error);
      return;
    }

    const name = protocol.getNameByPayloadType(data.payloadType);
    if ('clientMsgId' in data) {
      const index = this.commandStack.findIndex(
        item => item.id == data.clientMsgId,
      );
      if (index !== -1) {
        const command = this.commandStack.splice(index, 1).pop();
        if (command && command.done) {
          command.done({
            ...data,
            payloadTypeName: name,
          });
        }
      }
    }
    this.emit(name, data);
  };
}
