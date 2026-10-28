import { Text, View } from "react-native";
import { parseEgp } from "@b42y/core";

export default function App() {
  return (
    <View>
      <Text testID="core-amount">{parseEgp("1.00")}</Text>
    </View>
  );
}
