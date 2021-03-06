import * as ProtoBuf from 'protobufjs';
//import { decodeRaw } from './decoderaw';

const INT_SIZE = 4;
export class Codec {
  messageModels: Record<string, ProtoBuf.Type> = {};
  enums: Record<string, ProtoBuf.Enum> = {};
  payloadTypeToMesageNameMap: Record<number, string> = {};

  ProtoMessage?: ProtoBuf.Type;

  loadFromFiles = (files: Array<string>): Promise<void> => {
    return Promise.all(
      files.map(filename =>
        ProtoBuf.load(filename).then(root => {
          return this.traverseTypes(root);
        }),
      ),
    ).then(() => {
      return this.build();
    });
  };
  traverseTypes = (current: any): void => {
    if (current instanceof ProtoBuf.Type) {
      this.messageModels[current.name] = current;
    }
    if (current instanceof ProtoBuf.Enum) {
      this.enums[current.name] = current;
    }
    if (current.nestedArray != undefined) {
      current.nestedArray.forEach((nested: any) => {
        this.traverseTypes(nested);
      });
    }
  };

  build = () => {
    // validate model data
    if (!this.enums['ProtoOAPayloadType']) {
      throw 'Miss ProtoOAPayloadType, a backbone enum';
    }
    if (!this.messageModels['ProtoMessage']) {
      throw 'Miss ProtoMessage, a backbone message';
    }

    // build ProtoMessage
    this.ProtoMessage = this.messageModels['ProtoMessage'];

    // build payloadTypeToMesageNameMap
    const payloadTypes = {
      ...this.enums['ProtoOAPayloadType'].values,
      ...this.enums['ProtoPayloadType'].values,
    };

    for (const messageName of Object.keys(this.messageModels)) {
      const model = this.messageModels[messageName];
      const modelPayloadType =
        model.fields.payloadType?.getOption('default') || '';
      if (modelPayloadType && modelPayloadType in payloadTypes) {
        this.payloadTypeToMesageNameMap[
          payloadTypes[modelPayloadType]
        ] = messageName;
      }
    }
    //console.log(payloadTypes);
    //console.log(this.payloadTypeToMesageNameMap);
  };

  getPayloadTypeByName = (name: string): number => {
    for (const type in this.payloadTypeToMesageNameMap) {
      if (
        Object.prototype.hasOwnProperty.call(
          this.payloadTypeToMesageNameMap,
          type,
        )
      ) {
        const messageName = this.payloadTypeToMesageNameMap[type];
        if (messageName == name) {
          return +type;
        }
      }
    }
    return 0;
  };

  getNameByPayloadType = (payloadType: number): string => {
    return this.payloadTypeToMesageNameMap[payloadType] || '';
  };

  length = (length: number): Buffer => {
    const buffer = Buffer.alloc(INT_SIZE);
    buffer.writeInt32BE(length, 0);
    return buffer;
  };

  serialize(data: Uint8Array): Buffer {
    const len = this.length(data.length);
    const totalLength = len.length + data.length;
    return Buffer.concat([len, data], totalLength);
  }

  deserialize = (data: Buffer, offset = 0): Buffer => {
    let buffer = Buffer.alloc(0);
    buffer = Buffer.concat([buffer, data.slice(offset)]);
    const length = buffer.readInt32BE(offset);
    const remainingBytes = buffer.length - offset - INT_SIZE;
    if (remainingBytes >= length) {
      const payload = buffer.slice(
        offset + INT_SIZE,
        length + offset + INT_SIZE,
      );
      return payload;
    } else {
      throw new Error('buffer not large enough');
    }
  };

  encode = (
    messageName: string,
    payload?: Record<string, any>,
    clientMsgId?: string,
  ): Buffer => {
    if (!this.ProtoMessage) {
      throw 'model does not load';
    }
    // find mesageModel by messagename
    if (typeof this.messageModels[messageName] == 'undefined') {
      throw 'message not found';
    }
    const model = this.messageModels[messageName];
    let message = {
      payloadType: this.getPayloadTypeByName(messageName),
    };

    if (payload) {
      message = {
        ...message,
        ...payload,
      };
    }

    const secondLevelMessage = model.create(message);

    const result = this.ProtoMessage.create({
      payloadType: this.getPayloadTypeByName(messageName),
      payload: model.encode(secondLevelMessage).finish(),
      clientMsgId,
    });

    const unit8Message = this.ProtoMessage.encode(result).finish();
    return this.serialize(unit8Message);
  };

  decode = (
    data: string,
  ): {
    payloadType: number;
    messageName: string;
    payload: Record<string, any>;
    clientMsgId: string | null;
  } => {
    if (!this.ProtoMessage) {
      throw 'model does load';
    }
    let firstLvMessage: Record<string, any> = {};
    const message = Buffer.from(data, 'binary');

    try {
      const buffer = this.deserialize(message);
      firstLvMessage = this.ProtoMessage.decode(buffer);
    } catch (error) {
      throw 'response message is not ProtoMessage';
    }

    if (!('payload' in firstLvMessage) || !('payloadType' in firstLvMessage)) {
      throw 'response message invalid';
    }
    let clientMsgId = null;
    if ('clientMsgId' in firstLvMessage) {
      clientMsgId = firstLvMessage['clientMsgId'];
    }
    const payloadType = +firstLvMessage['payloadType'];
    const encodedSecondLvMessage = firstLvMessage['payload'];
    const modelName = this.payloadTypeToMesageNameMap[payloadType];
    if (!modelName) {
      throw 'Payloadtype ' + payloadType + ' not found';
    }
    const model = this.messageModels[modelName];
    const secondLvmessage = model.decode(encodedSecondLvMessage);
    return {
      payloadType: payloadType,
      messageName: modelName,
      payload: secondLvmessage.toJSON(),
      clientMsgId,
    };
  };
}
